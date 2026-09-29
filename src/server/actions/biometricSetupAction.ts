import crypto from 'crypto';
import { AuthenticationError } from '@anupheaus/common';
import type { WebAuthnAuthStore } from '../../common/auth';
import { biometricSetupAction } from '../../common/internalActions';
import type { BiometricSetupRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import { isAuthKey } from '../../common/auth';
import type { NexusServerAction } from './createServerActionHandler';

const COOKIE_NAME = 'nexus_session';

export async function handleBiometricSetup(
  store: WebAuthnAuthStore,
  req: BiometricSetupRequest,
  sessionToken: string,
): Promise<void> {
  // Keys that are not strings (an object is a query operator to a MongoDB store) find nothing (sc-620).
  if (!isAuthKey(sessionToken)) throw new AuthenticationError({ message: 'Invalid session for biometric setup' });
  if (!isAuthKey(req?.keyHash)) throw new AuthenticationError({ message: 'Invalid key for biometric setup' });
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

export function createBiometricSetupAction(store: WebAuthnAuthStore): NexusServerAction {
  return createServerActionHandler(
    biometricSetupAction,
    async (req, utils) => {
      const sessionToken = utils.getCookie(COOKIE_NAME);
      if (!sessionToken) throw new AuthenticationError({ message: 'Not authenticated' });
      return handleBiometricSetup(store, req, sessionToken);
    },
  );
}
