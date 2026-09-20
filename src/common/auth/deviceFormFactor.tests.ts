import { describe, it, expect } from 'vitest';
import { deriveDeviceFormFactor, type DeviceFormFactorSignals } from './deviceFormFactor';

// Realistic user-agent strings for the device classes under test.
const WINDOWS_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ANDROID_PHONE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_TABLET_UA = 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('deriveDeviceFormFactor', () => {
  describe('desktop', () => {
    it('classifies a conventional desktop (no touch, desktop UA) as desktop', () => {
      const signals: DeviceFormFactorSignals = {
        userAgent: WINDOWS_CHROME_UA,
        maxTouchPoints: 0,
        screenWidth: 2560,
        screenHeight: 1440,
        viewportWidth: 1920,
        viewportHeight: 1080,
      };
      expect(deriveDeviceFormFactor(signals)).toBe('desktop');
    });

    it('classifies a Windows touchscreen laptop (touch points, desktop UA, no Mobile token) as desktop', () => {
      const signals: DeviceFormFactorSignals = {
        userAgent: WINDOWS_CHROME_UA,
        maxTouchPoints: 10,
        screenWidth: 1920,
        screenHeight: 1080,
        viewportWidth: 1536,
        viewportHeight: 864,
      };
      expect(deriveDeviceFormFactor(signals)).toBe('desktop');
    });

    it('classifies undefined signals as desktop', () => {
      expect(deriveDeviceFormFactor(undefined)).toBe('desktop');
    });
  });

  describe('mobile', () => {
    it('classifies an Android phone (Mobile UA, small viewport) as mobile', () => {
      const signals: DeviceFormFactorSignals = {
        userAgent: ANDROID_PHONE_UA,
        maxTouchPoints: 5,
        screenWidth: 412,
        screenHeight: 915,
        viewportWidth: 384,
        viewportHeight: 854,
      };
      expect(deriveDeviceFormFactor(signals)).toBe('mobile');
    });

    it('classifies an iPhone as mobile', () => {
      const signals: DeviceFormFactorSignals = {
        userAgent: IPHONE_UA,
        maxTouchPoints: 5,
        screenWidth: 390,
        screenHeight: 844,
        viewportWidth: 390,
        viewportHeight: 664,
      };
      expect(deriveDeviceFormFactor(signals)).toBe('mobile');
    });
  });

  describe('tablet', () => {
    it('classifies an Android tablet (Android UA without Mobile token, large viewport) as tablet', () => {
      const signals: DeviceFormFactorSignals = {
        userAgent: ANDROID_TABLET_UA,
        maxTouchPoints: 5,
        screenWidth: 800,
        screenHeight: 1280,
        viewportWidth: 800,
        viewportHeight: 1226,
      };
      expect(deriveDeviceFormFactor(signals)).toBe('tablet');
    });

    it('classifies an iPad as tablet', () => {
      const signals: DeviceFormFactorSignals = {
        userAgent: IPAD_UA,
        maxTouchPoints: 5,
        screenWidth: 820,
        screenHeight: 1180,
        viewportWidth: 820,
        viewportHeight: 1080,
      };
      expect(deriveDeviceFormFactor(signals)).toBe('tablet');
    });
  });

  describe('tablet/mobile boundary', () => {
    it('classifies a mobile UA with a smallest dimension of exactly 600 as tablet', () => {
      const signals: DeviceFormFactorSignals = {
        userAgent: ANDROID_PHONE_UA,
        maxTouchPoints: 5,
        screenWidth: 600,
        screenHeight: 960,
        viewportWidth: 600,
        viewportHeight: 900,
      };
      expect(deriveDeviceFormFactor(signals)).toBe('tablet');
    });

    it('classifies a mobile UA with a smallest dimension of 599 as mobile', () => {
      const signals: DeviceFormFactorSignals = {
        userAgent: ANDROID_PHONE_UA,
        maxTouchPoints: 5,
        screenWidth: 599,
        screenHeight: 960,
        viewportWidth: 599,
        viewportHeight: 900,
      };
      expect(deriveDeviceFormFactor(signals)).toBe('mobile');
    });
  });
});
