import type { NexusDeviceDetails } from './authTypes';

/** Physical class of a device, derived from the signals a browser/webview exposes. */
export type DeviceFormFactor = 'desktop' | 'tablet' | 'mobile';

/** Android's standard tablet breakpoint: a touch device is a tablet at >= 600dp smallest width. */
const TABLET_MIN_DIMENSION_PX = 600;

/** Signals needed to classify a device; a subset of {@link NexusDeviceDetails}. */
export type DeviceFormFactorSignals = Pick<
  NexusDeviceDetails,
  'userAgent' | 'maxTouchPoints' | 'screenWidth' | 'screenHeight' | 'viewportWidth' | 'viewportHeight'
>;

/**
 * Classify a device as desktop / tablet / mobile from its reported signals.
 *
 * Kept pure and dependency-free so it can run on the client (when collecting details) and on the
 * server (as a fallback for auth records saved before `formFactor` was stored). A device with no
 * touch points and a non-mobile user agent is a desktop; touch devices split on the 600px smallest
 * dimension, matching the app's own tablet/phone breakpoint.
 */
export function deriveDeviceFormFactor(signals: DeviceFormFactorSignals | undefined): DeviceFormFactor {
  if (signals == null) return 'desktop';
  const { userAgent = '', maxTouchPoints = 0, screenWidth = 0, screenHeight = 0, viewportWidth = 0, viewportHeight = 0 } = signals;

  // iPadOS reports itself as a Mac with touch points; treat any iPad UA as a tablet up front.
  if (/iPad/i.test(userAgent)) return 'tablet';

  const isMobileUserAgent = /Android|iPhone|iPod|Mobile/i.test(userAgent);
  // No touch and not a mobile UA => a conventional desktop/laptop.
  if (!isMobileUserAgent && maxTouchPoints === 0) return 'desktop';
  // Touch-capable desktop OS (e.g. a Windows touchscreen laptop) with no mobile UA stays a desktop.
  if (!isMobileUserAgent) return 'desktop';

  // Mobile OS: split tablet vs phone on the smallest available dimension, preferring the viewport.
  const width = viewportWidth || screenWidth;
  const height = viewportHeight || screenHeight;
  const smallestDimension = Math.min(width || 0, height || 0);
  return smallestDimension >= TABLET_MIN_DIMENSION_PX ? 'tablet' : 'mobile';
}
