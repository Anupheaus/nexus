import type { SocketAPIDeviceDetails } from '../../common/auth';

export async function computeDeviceId(details: SocketAPIDeviceDetails): Promise<string> {
  const stable = [
    details.userAgent,
    details.platform,
    String(details.hardwareConcurrency),
    String(details.screenWidth),
    String(details.screenHeight),
    String(details.colorDepth),
    String(details.pixelRatio),
    details.timezone,
  ].join('|');

  const encoder = new TextEncoder();
  const data = encoder.encode(stable);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
