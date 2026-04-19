import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './RateLimiter';

describe('RateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows requests under the limit', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
  });

  it('blocks the request that exceeds the limit', () => {
    const limiter = new RateLimiter(3, 60_000);
    limiter.check('1.2.3.4');
    limiter.check('1.2.3.4');
    limiter.check('1.2.3.4');
    expect(limiter.check('1.2.3.4')).toBe(false);
  });

  it('does not affect other IPs', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check('1.2.3.4');
    limiter.check('1.2.3.4'); // blocked
    expect(limiter.check('5.6.7.8')).toBe(true);
  });

  it('resets after the window expires', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check('1.2.3.4');
    expect(limiter.check('1.2.3.4')).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(limiter.check('1.2.3.4')).toBe(true);
  });

  it('reset() clears the record for an IP', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check('1.2.3.4');
    expect(limiter.check('1.2.3.4')).toBe(false);
    limiter.reset('1.2.3.4');
    expect(limiter.check('1.2.3.4')).toBe(true);
  });

  it('supports a composite key via additionalKey', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check('1.2.3.4', 'route-a');
    expect(limiter.check('1.2.3.4', 'route-a')).toBe(false);
    expect(limiter.check('1.2.3.4', 'route-b')).toBe(true);
  });
});
