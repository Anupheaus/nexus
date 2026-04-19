import { describe, it, expect } from 'vitest';
import { computeDeviceId } from './computeDeviceId';

describe('computeDeviceId', () => {
  it('returns a non-empty string', async () => {
    const id = await computeDeviceId({
      userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'en-GB',
      hardwareConcurrency: 8, maxTouchPoints: 0, vendor: 'Google Inc.',
      screenWidth: 1920, screenHeight: 1080, viewportWidth: 1280, viewportHeight: 720,
      colorDepth: 24, pixelRatio: 1, timezone: 'Europe/London',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns the same id for the same stable fields regardless of viewport', async () => {
    const base = {
      userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'en-GB',
      hardwareConcurrency: 8, maxTouchPoints: 0, vendor: 'Google Inc.',
      screenWidth: 1920, screenHeight: 1080, colorDepth: 24, pixelRatio: 1, timezone: 'Europe/London',
    };
    const id1 = await computeDeviceId({ ...base, viewportWidth: 1280, viewportHeight: 720 });
    const id2 = await computeDeviceId({ ...base, viewportWidth: 800, viewportHeight: 600 });
    expect(id1).toBe(id2);
  });

  it('returns different ids for different stable fields', async () => {
    const base = {
      platform: 'Win32', language: 'en-GB', hardwareConcurrency: 8, maxTouchPoints: 0,
      vendor: 'Google Inc.', screenWidth: 1920, screenHeight: 1080, viewportWidth: 1280,
      viewportHeight: 720, colorDepth: 24, pixelRatio: 1, timezone: 'Europe/London',
    };
    const id1 = await computeDeviceId({ ...base, userAgent: 'Chrome/120' });
    const id2 = await computeDeviceId({ ...base, userAgent: 'Firefox/121' });
    expect(id1).not.toBe(id2);
  });
});
