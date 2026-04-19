import { describe, it, expect } from 'vitest';
import { collectDeviceDetails } from './collectDeviceDetails';

describe('collectDeviceDetails', () => {
  it('returns an object with all required fields', () => {
    const details = collectDeviceDetails();
    expect(typeof details.userAgent).toBe('string');
    expect(typeof details.platform).toBe('string');
    expect(typeof details.language).toBe('string');
    expect(typeof details.hardwareConcurrency).toBe('number');
    expect(typeof details.maxTouchPoints).toBe('number');
    expect(typeof details.vendor).toBe('string');
    expect(typeof details.screenWidth).toBe('number');
    expect(typeof details.screenHeight).toBe('number');
    expect(typeof details.viewportWidth).toBe('number');
    expect(typeof details.viewportHeight).toBe('number');
    expect(typeof details.colorDepth).toBe('number');
    expect(typeof details.pixelRatio).toBe('number');
    expect(typeof details.timezone).toBe('string');
  });
});
