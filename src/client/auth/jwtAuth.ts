import { collectDeviceDetails } from './collectDeviceDetails';
import { computeDeviceId } from './computeDeviceId';
import type { signInAction } from '../../common/internalActions';
import type { GetUseActionType } from '../hooks/useAction';

export type SignInCaller = GetUseActionType<typeof signInAction>;

export async function performJwtSignIn<C>(
  callSignIn: SignInCaller,
  credentials: C,
  reconnect: () => void,
): Promise<void> {
  const details = collectDeviceDetails();
  const deviceId = await computeDeviceId(details);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await callSignIn({ ...(credentials as any), deviceId, deviceDetails: details });
  reconnect();
}
