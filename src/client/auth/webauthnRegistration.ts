import { collectDeviceDetails } from './collectDeviceDetails';
import { computeKeyHash, getPrfResult, getRpId } from './webauthnUtils';
import { storeBiometricKey } from './biometricAuth';
import type { webauthnInviteAction, webauthnRegisterAction } from '../../common/internalActions';
import type { GetUseActionType } from '../hooks/useAction';

export type InviteCaller = GetUseActionType<typeof webauthnInviteAction>;
export type RegisterCaller = GetUseActionType<typeof webauthnRegisterAction>;

export async function performWebAuthnRegistration(
  callInvite: InviteCaller,
  callRegister: RegisterCaller,
  reconnect: () => void,
  onPrf: ((userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>) | undefined,
  name?: string,
): Promise<void> {
  const requestId = new URLSearchParams(window.location.search).get('requestId');
  if (!requestId) throw new Error('WebAuthn registration requires a ?requestId= query parameter (from invite URL)');

  const { registrationToken, inviteDetails } = await callInvite({ requestId });

  // userName shown in passkey manager — include account context when the passkey is account-scoped.
  const passkeyName = inviteDetails.accountName != null
    ? `${inviteDetails.userName} (${inviteDetails.accountName})`
    : inviteDetails.userName;

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: new TextEncoder().encode(registrationToken),
      rp: { id: getRpId(), name: inviteDetails.appName },
      user: {
        // userHandle uniquely identifies the (user, account) pair — ensures separate passkeys
        // per account rather than the same passkey being reused across accounts.
        id: new TextEncoder().encode(inviteDetails.userHandle),
        name: passkeyName,
        displayName: inviteDetails.userName,
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
      extensions: {
        prf: { eval: { first: new TextEncoder().encode('nexus-auth') } },
      } as AuthenticationExtensionsClientInputs,
    },
  });

  if (!credential) throw new Error('Passkey creation cancelled or failed');

  const prfResult = getPrfResult(credential as PublicKeyCredential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');

  const keyHash = await computeKeyHash(prfResult);
  const deviceDetails = collectDeviceDetails();

  const { userId, accountId } = await callRegister({ registrationToken, keyHash, deviceDetails });

  const url = new URL(window.location.href);
  url.searchParams.delete('requestId');
  window.history.replaceState({}, '', url.toString());

  // Opportunistically cache the PRF key biometrically on Capacitor native.
  if (name != null) await storeBiometricKey(name, userId, prfResult).catch(() => { /* non-fatal */ });

  if (onPrf) onPrf(userId, prfResult, accountId);
  reconnect();
}
