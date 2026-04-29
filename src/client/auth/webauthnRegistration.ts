import { collectDeviceDetails } from './collectDeviceDetails';
import { computeKeyHash, getPrfResult } from './webauthnUtils';

export type InviteCaller = (req: { requestId: string }) => Promise<{ registrationToken: string; userDetails: { name: string; displayName?: string } }>;
export type RegisterCaller = (req: { registrationToken: string; keyHash: string; deviceDetails: ReturnType<typeof collectDeviceDetails> }) => Promise<{ userId: string }>;

export async function performWebAuthnRegistration(
  callInvite: InviteCaller,
  callRegister: RegisterCaller,
  reconnect: () => void,
  onPrf: ((userId: string, prfOutput: ArrayBuffer) => void | Promise<void>) | undefined,
): Promise<void> {
  const requestId = new URLSearchParams(window.location.search).get('requestId');
  if (!requestId) throw new Error('WebAuthn registration requires a ?requestId= query parameter (from invite URL)');

  const { registrationToken, userDetails } = await callInvite({ requestId });

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: new TextEncoder().encode(registrationToken),
      rp: { id: window.location.hostname, name: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userDetails.name),
        name: userDetails.name,
        displayName: userDetails.displayName ?? userDetails.name,
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: { userVerification: 'required' },
      extensions: {
        prf: { eval: { first: new TextEncoder().encode('socket-api-auth') } },
      } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey creation cancelled or failed');

  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');

  const keyHash = await computeKeyHash(prfResult);
  const details = collectDeviceDetails();

  const { userId } = await callRegister({ registrationToken, keyHash, deviceDetails: details });

  const url = new URL(window.location.href);
  url.searchParams.delete('requestId');
  window.history.replaceState({}, '', url.toString());

  if (onPrf) onPrf(userId, prfResult);
  reconnect();
}
