import { describe, it, expect } from 'vitest';
import { resolveSecurityConfig, mergeSecurityConfig, SECURITY_DEFAULTS } from './SecurityConfig';

describe('resolveSecurityConfig', () => {
  it('returns defaults when called with no argument', () => {
    const result = resolveSecurityConfig();
    expect(result.rateLimit).toEqual(SECURITY_DEFAULTS.rateLimit);
    expect(result.cors).toBe(false);
    expect(result.maxBodySizeKb).toBe(512);
    expect(result.trustedProxyHops).toBe(1);
    expect(result.securityHeaders).toBe(true);
  });

  it('merges partial rateLimit over defaults', () => {
    const result = resolveSecurityConfig({ rateLimit: { maxRequests: 10 } });
    expect(result.rateLimit).toEqual({
      maxRequests: 10,
      windowMs: SECURITY_DEFAULTS.rateLimit.windowMs,
      message: SECURITY_DEFAULTS.rateLimit.message,
    });
  });

  it('disables rateLimit when set to false', () => {
    const result = resolveSecurityConfig({ rateLimit: false });
    expect(result.rateLimit).toBe(false);
  });

  it('merges partial cors over cors defaults', () => {
    const result = resolveSecurityConfig({ cors: { allowedOrigins: 'https://myapp.com' } });
    expect(result.cors).toMatchObject({
      allowedOrigins: 'https://myapp.com',
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAgeSeconds: 600,
    });
  });

  it('disables cors when set to false', () => {
    const result = resolveSecurityConfig({ cors: false });
    expect(result.cors).toBe(false);
  });

  it('overrides scalar fields', () => {
    const result = resolveSecurityConfig({ maxBodySizeKb: 1024, trustedProxyHops: 2, securityHeaders: false });
    expect(result.maxBodySizeKb).toBe(1024);
    expect(result.trustedProxyHops).toBe(2);
    expect(result.securityHeaders).toBe(false);
  });
});

describe('mergeSecurityConfig', () => {
  it('deep merges rateLimit — only maxRequests overridden', () => {
    const base = resolveSecurityConfig({ rateLimit: { maxRequests: 100, windowMs: 60_000, message: 'slow down' } });
    const result = mergeSecurityConfig(base, { rateLimit: { maxRequests: 10 } });
    expect(result.rateLimit).toEqual({ maxRequests: 10, windowMs: 60_000, message: 'slow down' });
  });

  it('disables rateLimit via per-route override', () => {
    const base = resolveSecurityConfig();
    const result = mergeSecurityConfig(base, { rateLimit: false });
    expect(result.rateLimit).toBe(false);
  });

  it('enables cors from false base', () => {
    const base = resolveSecurityConfig({ cors: false });
    const result = mergeSecurityConfig(base, { cors: { allowedOrigins: 'https://myapp.com' } });
    expect(result.cors).toMatchObject({
      allowedOrigins: 'https://myapp.com',
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAgeSeconds: 600,
    });
  });

  it('deep merges cors — only allowedOrigins overridden', () => {
    const base = resolveSecurityConfig({ cors: { allowedOrigins: 'https://a.com', maxAgeSeconds: 300 } });
    const result = mergeSecurityConfig(base, { cors: { allowedOrigins: 'https://b.com' } });
    const cors = result.cors;
    if (cors === false) throw new Error('Expected cors to be enabled');
    expect(cors.allowedOrigins).toBe('https://b.com');
    expect(cors.maxAgeSeconds).toBe(300);
  });

  it('leaves unspecified override fields unchanged', () => {
    const base = resolveSecurityConfig({ maxBodySizeKb: 256 });
    const result = mergeSecurityConfig(base, { rateLimit: { maxRequests: 5 } });
    expect(result.maxBodySizeKb).toBe(256);
  });
});
