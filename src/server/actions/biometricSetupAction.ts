import crypto from 'crypto';
import { AuthenticationError } from '@anupheaus/common';
import type { WebAuthnAuthStore } from '../../common/auth';
import { biometricSetupAction } from '../../common/internalActions';
import type { BiometricSetupRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';

const COOKIE_NAME = 'socketapi_session';

export async function handleBiometricSetup(
  store: WebAuthnAuthStore,
  req: BiometricSetupRequest,
  sessionToken: string,
): Promise<void> {
  const session = await store.findBySessionToken(sessionToken);
  if (!session?.isEnabled) throw new AuthenticationError({ message: 'Invalid session for biometric setup' });

  const existing = await store.findByKeyHash(req.keyHash);
  // Idempotent: this key is already registered, nothing to do.
  if (existing != null) return;

  await store.create({
    requestId: crypto.randomUUID(),
    sessionToken: '',
    userId: session.userId,
    accountId: session.accountId,
    deviceId: req.deviceDetails.id,
    isEnabled: true,
    keyHash: req.keyHash,
    deviceDetails: req.deviceDetails,
    lastConnectedAt: Date.now(),
  });
}

export function createBiometricSetupAction(store: WebAuthnAuthStore): SocketAPIServerAction {
  return createServerActionHandler(
    biometricSetupAction,
    async (req, utils) => {
      const sessionToken = utils.getCookie(COOKIE_NAME);
      if (!sessionToken) throw new AuthenticationError({ message: 'Not authenticated' });
      return handleBiometricSetup(store, req, sessionToken);
    },
  );
}
