import { collectDeviceDetails } from './collectDeviceDetails';
import { computeKeyHash, getPrfResult } from './webauthnUtils';

export async function performWebAuthnReauth(
  name: string,
  reconnect: () => void,
  onPrf: ((userId: string, prfOutput: ArrayBuffer) => void | Promise<void>) | undefined,
): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
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
  const details = collectDeviceDetails();

  const res = await fetch(`/${name}/socketAPI/webauthn/reauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ keyHash, deviceDetails: details }),
  });
  if (!res.ok) throw new Error(`WebAuthn re-authentication failed: ${res.status}`);
  const { userId } = await res.json() as { userId: string };

  if (onPrf) await onPrf(userId, prfResult);
  reconnect();
}
