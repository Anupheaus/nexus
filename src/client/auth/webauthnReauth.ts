import { collectDeviceDetails } from './collectDeviceDetails';
import { computeKeyHash, getPrfResult, getRpId } from './webauthnUtils';
import type { webauthnReauthAction } from '../../common/internalActions';
import type { GetUseActionType } from '../hooks/useAction';

export type ReauthCaller = GetUseActionType<typeof webauthnReauthAction>;

export async function performWebAuthnReauth(
  callReauth: ReauthCaller,
  reconnect: () => void,
  onPrf: ((userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>) | undefined,
): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: getRpId(),
      userVerification: 'required',
      extensions: {
        prf: { eval: { first: new TextEncoder().encode('socket-api-auth') } },
      } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey authentication cancelled or failed');

  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');

  const keyHash = await computeKeyHash(prfResult);
  const deviceDetails = collectDeviceDetails();

  const { userId, accountId } = await callReauth({ keyHash, deviceDetails });

  if (onPrf) await onPrf(userId, prfResult, accountId);
  reconnect();
}
