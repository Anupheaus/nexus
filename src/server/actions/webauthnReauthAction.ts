import { AuthenticationError } from '@anupheaus/common';
import crypto from 'crypto';
import { isAuthKey, type WebAuthnAuthRecord, type WebAuthnAuthStore } from '../../common/auth';
import { webauthnChallengeAction, webauthnReauthAction } from '../../common/internalActions';
import type { WebAuthnReauthRequest, WebAuthnAuthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';
import { verifyPasskeySignIn, type PasskeyVerificationConfig } from '../auth/passkeyVerification';
import type { ChallengeSigner } from '../auth/webauthnChallenge';
import { logAuthFailure, logAuthStep, logAuthSuccess } from '../auth/authEventLog';
import type { AuthFailureReason } from '../auth/authEventModels';
import { createVerificationFailureCollector } from '../auth/verificationFailureCollector';
import { findInstallationDevice, isInstallationId, planNewInstallation, type PasskeyInstallationRefusal } from '../auth/passkeyInstallations';

const COOKIE_NAME = 'nexus_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };
const REAUTH_FAILED = 'WebAuthn re-authentication failed';

/** A fresh sign-in challenge (sc-627). The challenge itself is never logged. */
export function handleWebAuthnChallenge(signer: ChallengeSigner, now: number = Date.now()): { challenge: string } {
  logAuthStep({ event: 'challenge', method: 'passkey', step: 'challenge-issued' });
  return { challenge: signer.issue(now) };
}

interface ReauthRefusalDetail {
  /** True when the sign-in would have registered an installation the passkey has not signed in on before (sc-645). */
  isNewInstallation?: boolean;
}

/**
 * Logs the failed sign-in (one `[Auth]` warn with its reason) and refuses it (a 401) with the same words for every reason.
 * Never logs credential ids or keys.
 */
function refuseReauth(reason: AuthFailureReason, userId?: string, detail?: ReauthRefusalDetail): never {
  logAuthFailure({ event: 'sign-in', method: 'passkey', reason, userId, ...(detail != null ? { detail: { ...detail } } : {}) });
  throw new AuthenticationError(REAUTH_FAILED);
}

/** The `[Auth]` reason for a passkey that may not register a new installation. */
const NEW_INSTALLATION_REFUSAL_REASONS: Record<PasskeyInstallationRefusal, AuthFailureReason> = {
  'no-device': 'unknown-credential',
  'device-disabled': 'device-disabled',
  'devices-disagree': 'credential-mismatch',
};

/** The MongoDB error code for a unique-index violation. */
const DUPLICATE_KEY_ERROR_CODE = 11000;

/** Whether a store refused a record because its unique (credential id, installation id) key already exists. */
function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null | undefined)?.code === DUPLICATE_KEY_ERROR_CODE;
}

interface NewInstallationSignIn {
  store: WebAuthnAuthStore;
  verification: PasskeyVerificationConfig;
  signer: ChallengeSigner;
  req: WebAuthnReauthRequest;
  devices: WebAuthnAuthRecord[];
  now: number;
}

/**
 * Registers an installation a synced passkey has not signed in on before as a new device (sc-645), and resolves its
 * session token. The passkey's other devices keep their sessions, and the new device takes its own licence seat.
 */
async function signInNewInstallation({ store, verification, signer, req, devices, now }: NewInstallationSignIn): Promise<{ record: WebAuthnAuthRecord; sessionToken: string; }> {
  const newInstallation: ReauthRefusalDetail = { isNewInstallation: true };
  const plan = planNewInstallation(devices);
  if (!plan.isAllowed) refuseReauth(NEW_INSTALLATION_REFUSAL_REASONS[plan.reason], devices[0]?.userId, newInstallation);
  const { template } = plan;
  // Why a ceremony failed goes to the server's log only; the client learns just that it did.
  const failure = createVerificationFailureCollector();
  const verified = await verifyPasskeySignIn(verification, signer, req.credential, template, now, failure.onError);
  if (verified == null) refuseReauth(failure.reasonOr('bad-signature'), template.userId, newInstallation);
  // One sign-in, one claim for the passkey, so it creates at most one device whatever installation ids it is sent with;
  // and none once the passkey is revoked, even if the revoked device has since been deleted.
  if (!await store.claimPasskeySignIn({ credentialId: template.credentialId, challenge: verified.challenge, challengeIssuedAt: verified.challengeIssuedAt, isNewDevice: true })) {
    // The claim also refuses a revoked passkey whose disabled device was deleted, so say which it was (only asked on a refusal).
    refuseReauth(await store.isPasskeyRevoked(template.credentialId) ? 'device-disabled' : 'replay', template.userId, newInstallation);
  }

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const requestId = crypto.randomUUID();
  const record: WebAuthnAuthRecord = {
    requestId,
    deviceId: crypto.randomUUID(),
    userId: template.userId,
    ...(template.accountId != null ? { accountId: template.accountId } : {}),
    isEnabled: true,
    sessionToken,
    credentialId: template.credentialId,
    credentialPublicKey: template.credentialPublicKey,
    credentialCounter: verified.credentialCounter,
    lastChallengeIssuedAt: verified.challengeIssuedAt,
    installationId: req.installationId,
    deviceDetails: req.deviceDetails,
    lastConnectedAt: now,
    createdAt: now,
  };
  try {
    // The store's unique (credential id, installation id) index refuses the second of two identical sign-ins.
    await store.create(record);
  } catch (error) {
    // Still a 401 whatever failed (2.0.7's behaviour); only the logged reason tells a duplicate from a store failure,
    // and never from the error's text, which a driver can fill with record values.
    refuseReauth(isDuplicateKeyError(error) ? 'passkey-already-registered' : 'store-error', template.userId, newInstallation);
  }
  // A device of the passkey revoked between the claim and the create: the new device must not outlive that revoke.
  if (await store.isPasskeyRevoked(template.credentialId)) {
    await store.update(requestId, { isEnabled: false });
    refuseReauth('device-disabled', template.userId, newInstallation);
  }
  return { record, sessionToken };
}

/**
 * Signs a device in by its passkey (sc-627). The passkey must have signed a challenge this app's servers issued, fresher
 * than the last one the device answered, with the public key stored when it registered. Nothing a client merely knows
 * (such as a key hash) signs anyone in.
 *
 * A device is one installation of the app (sc-645): a synced passkey signing in on an installation it has not signed in
 * on before registers that installation as a new device, and the devices it already has keep their sessions. The rules
 * that guard a passkey hold for the passkey, not per device, and the store enforces them atomically:
 * - a signed sign-in is claimed once for the passkey, so it is never accepted again on a sibling device;
 * - so one sign-in creates at most one new device, whatever installation ids it is sent with;
 * - a passkey any of whose devices was ever disabled, signed out or deleted registers no new device.
 */
export async function handleWebAuthnReauth(
  store: WebAuthnAuthStore,
  verification: PasskeyVerificationConfig,
  signer: ChallengeSigner,
  req: WebAuthnReauthRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
  now: number = Date.now(),
): Promise<WebAuthnAuthResponse> {
  // A credential id that is not a string (e.g. { "$ne": null }, an operator to a MongoDB store) finds nothing (sc-620).
  const credentialId = (req?.credential as { id?: unknown } | undefined)?.id;
  if (!isAuthKey(credentialId) || !isInstallationId(req.installationId)) refuseReauth('invalid-request');
  const devices = await store.findAllByCredentialId(credentialId);
  const record = findInstallationDevice(devices, req.installationId);
  if (record == null) {
    const { record: created, sessionToken } = await signInNewInstallation({ store, verification, signer, req, devices, now });
    setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
    logAuthSuccess({ event: 'sign-in', method: 'passkey', userId: created.userId, detail: { isNewInstallation: true } });
    return { userId: created.userId, accountId: created.accountId };
  }
  if (!record.isEnabled) refuseReauth('device-disabled', record.userId);

  // Why a ceremony failed goes to the server's log only; the client learns just that it did.
  const failure = createVerificationFailureCollector();
  const verified = await verifyPasskeySignIn(verification, signer, req.credential, record, now, failure.onError);
  if (verified == null) refuseReauth(failure.reasonOr('bad-signature'), record.userId);
  // The passkey is shared by every device it is synced to, so a signed sign-in is used once across all of them: the same
  // response sent with a sibling's installation id is refused, rather than signing that sibling out.
  if (!await store.claimPasskeySignIn({ credentialId, challenge: verified.challenge, challengeIssuedAt: verified.challengeIssuedAt, isNewDevice: false })) {
    refuseReauth('replay', record.userId);
  }

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  // The installation id is written too, so a device registered before installations were told apart becomes this one's.
  const patch = { sessionToken, lastConnectedAt: now, deviceDetails: req.deviceDetails, credentialCounter: verified.credentialCounter, installationId: req.installationId };
  if (store.recordSignIn != null) {
    // Atomic: the replay check and the write are one step, so of two identical sign-ins only one is recorded.
    // The patch carries the challenge time too, so a store that only writes the patch still advances the replay guard.
    if (!await store.recordSignIn(record.requestId, verified.challengeIssuedAt, { ...patch, lastChallengeIssuedAt: verified.challengeIssuedAt })) {
      refuseReauth('replay', record.userId);
    }
  } else {
    await store.update(record.requestId, { ...patch, lastChallengeIssuedAt: verified.challengeIssuedAt });
  }

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  logAuthSuccess({ event: 'sign-in', method: 'passkey', userId: record.userId });
  return { userId: record.userId, accountId: record.accountId };
}

export function createWebauthnChallengeAction(signer: ChallengeSigner): NexusServerAction {
  return createServerActionHandler(webauthnChallengeAction, async () => handleWebAuthnChallenge(signer), { isPublic: true });
}

export function createWebauthnReauthAction(store: WebAuthnAuthStore, verification: PasskeyVerificationConfig, signer: ChallengeSigner): NexusServerAction {
  return createServerActionHandler(
    webauthnReauthAction,
    async (req, { setCookie }) => handleWebAuthnReauth(store, verification, signer, req, setCookie),
    { isPublic: true },
  );
}
