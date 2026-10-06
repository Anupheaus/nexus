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
import { findInstallationDevice, isInstallationId, planNewInstallation } from '../auth/passkeyInstallations';
import { useLogger } from '../async-context/nexusContext';

const COOKIE_NAME = 'nexus_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };
const REAUTH_FAILED = 'WebAuthn re-authentication failed';

/** Logs why a passkey ceremony was refused: the reason only, never credential ids or keys. */
export function logVerificationError(ceremony: 'registration' | 'sign-in') {
  return (error: unknown) => {
    try {
      useLogger().warn(`A passkey ${ceremony} could not be verified`, { reason: error instanceof Error ? error.message : String(error) });
    } catch { /* no logger outside a request */ }
  };
}

/** A fresh sign-in challenge (sc-627). */
export function handleWebAuthnChallenge(signer: ChallengeSigner, now: number = Date.now()): { challenge: string } {
  return { challenge: signer.issue(now) };
}

/** Logs why a synced passkey could not register a new installation: the reason only, never credential ids or keys. */
function logNewInstallationRefused(reason: string): void {
  try {
    useLogger().warn('A passkey could not sign in on a new installation', { reason });
  } catch { /* no logger outside a request */ }
}

/** Logs a synced passkey registering an installation it has not signed in on before, as a new device (sc-645). */
function logNewInstallationRegistered(requestId: string): void {
  try {
    useLogger().info('A synced passkey signed in on a new installation, registered as a new device', { requestId });
  } catch { /* no logger outside a request */ }
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
  const plan = planNewInstallation(devices);
  if (!plan.isAllowed) {
    logNewInstallationRefused(plan.reason);
    throw new AuthenticationError(REAUTH_FAILED);
  }
  const { template } = plan;
  const verified = await verifyPasskeySignIn(verification, signer, req.credential, template, now, logVerificationError('sign-in'));
  if (verified == null) throw new AuthenticationError(REAUTH_FAILED);

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
    logNewInstallationRefused(error instanceof Error ? error.message : String(error));
    throw new AuthenticationError(REAUTH_FAILED);
  }
  logNewInstallationRegistered(requestId);
  return { record, sessionToken };
}

/**
 * Signs a device in by its passkey (sc-627). The passkey must have signed a challenge this app's servers issued, fresher
 * than the last one the device answered, with the public key stored when it registered. Nothing a client merely knows
 * (such as a key hash) signs anyone in.
 *
 * A device is one installation of the app (sc-645): a synced passkey signing in on an installation it has not signed in
 * on before registers that installation as a new device, and the devices it already has keep their sessions.
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
  if (!isAuthKey(credentialId) || !isInstallationId(req.installationId)) throw new AuthenticationError(REAUTH_FAILED);
  const devices = await store.findAllByCredentialId(credentialId);
  const record = findInstallationDevice(devices, req.installationId);
  if (record == null) {
    const { record: created, sessionToken } = await signInNewInstallation({ store, verification, signer, req, devices, now });
    setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
    return { userId: created.userId, accountId: created.accountId };
  }
  if (!record.isEnabled) throw new AuthenticationError(REAUTH_FAILED);

  // Why a ceremony failed goes to the server's log only; the client learns just that it did.
  const verified = await verifyPasskeySignIn(verification, signer, req.credential, record, now, logVerificationError('sign-in'));
  if (verified == null) throw new AuthenticationError(REAUTH_FAILED);

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  // The installation id is written too, so a device registered before installations were told apart becomes this one's.
  const patch = { sessionToken, lastConnectedAt: now, deviceDetails: req.deviceDetails, credentialCounter: verified.credentialCounter, installationId: req.installationId };
  if (store.recordSignIn != null) {
    // Atomic: the replay check and the write are one step, so of two identical sign-ins only one is recorded.
    // The patch carries the challenge time too, so a store that only writes the patch still advances the replay guard.
    if (!await store.recordSignIn(record.requestId, verified.challengeIssuedAt, { ...patch, lastChallengeIssuedAt: verified.challengeIssuedAt })) {
      throw new AuthenticationError(REAUTH_FAILED);
    }
  } else {
    await store.update(record.requestId, { ...patch, lastChallengeIssuedAt: verified.challengeIssuedAt });
  }

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
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
