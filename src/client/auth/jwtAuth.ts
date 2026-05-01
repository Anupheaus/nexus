import { collectDeviceDetails } from './collectDeviceDetails';
import type { signInAction } from '../../common/internalActions';
import type { GetUseActionType } from '../hooks/useAction';

export type SignInCaller = GetUseActionType<typeof signInAction>;

export async function performJwtSignIn<C>(
  callSignIn: SignInCaller,
  credentials: C,
  reconnect: () => void,
): Promise<void> {
  const deviceDetails = collectDeviceDetails();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await callSignIn({ credentials: credentials as any, deviceDetails });
  reconnect();
}
