import type { SocketAPIDeviceDetails } from '../../common/auth';

export function collectDeviceDetails(): SocketAPIDeviceDetails {
  const nav = navigator;
  return {
    id: crypto.randomUUID(),
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: (nav as any).deviceMemory as number | undefined,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    vendor: nav.vendor,
    screenWidth: screen.width,
    screenHeight: screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
