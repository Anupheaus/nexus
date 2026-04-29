import { collectDeviceDetails } from './collectDeviceDetails';
import { computeDeviceId } from './computeDeviceId';

export async function performJwtSignIn<C>(name: string, credentials: C, reconnect: () => void): Promise<void> {
  const details = collectDeviceDetails();
  const deviceId = await computeDeviceId(details);
  const res = await fetch(`/${name}/socketAPI/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: JSON.stringify({ ...(credentials as any), deviceId, deviceDetails: details }),
  });
  if (!res.ok) throw new Error(`Sign in failed: ${res.status}`);
  reconnect();
}
