import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../async-context/nexusContext', () => ({ useLogger: vi.fn(), useClient: vi.fn(), useRequestOrigin: vi.fn() }));
vi.mock('../security/securityLog', () => ({ securityWarn: vi.fn() }));

import { useClient, useLogger, useRequestOrigin } from '../async-context/nexusContext';
import { securityWarn } from '../security/securityLog';
import { logAuthFailure, logAuthStep, logAuthSuccess } from './authEventLog';

describe('authEventLog', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const createSubLogger = vi.fn(() => logger);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLogger).mockReturnValue({ createSubLogger } as never);
    vi.mocked(useRequestOrigin).mockReturnValue({ ip: '203.0.113.7', userAgent: 'Chrome' });
    vi.mocked(useClient).mockReturnValue(undefined);
  });

  it('logs a success at info through a "Nexus Auth" sub-logger, with the event fields and the request origin', () => {
    logAuthSuccess({ event: 'sign-in', method: 'passkey', userId: 'u1' });

    expect([createSubLogger.mock.calls[0], logger.info.mock.calls[0]]).toEqual([
      ['Nexus Auth'],
      ['[Auth] sign-in succeeded', { event: 'sign-in', outcome: 'success', method: 'passkey', userId: 'u1', ip: '203.0.113.7', userAgent: 'Chrome' }],
    ]);
  });

  it('logs a failure a user caused at warn with its reason', () => {
    logAuthFailure({ event: 'session', method: 'session-cookie', reason: 'stale-session' });

    expect([logger.warn.mock.calls[0], vi.mocked(securityWarn).mock.calls.length]).toEqual([
      ['[Auth] session failed', { event: 'session', outcome: 'failure', method: 'session-cookie', reason: 'stale-session', userId: undefined, ip: '203.0.113.7', userAgent: 'Chrome' }],
      0,
    ]);
  });

  it('logs a failure a safeguard blocked through securityWarn as the auth-blocked security event', () => {
    logAuthFailure({ event: 'sign-in', method: 'google', reason: 'oauth-state-mismatch' });

    expect([vi.mocked(securityWarn).mock.calls[0], logger.warn.mock.calls.length]).toEqual([
      ['[Auth] sign-in failed', expect.objectContaining({ securityEvent: 'auth-blocked', event: 'sign-in', outcome: 'failure', reason: 'oauth-state-mismatch' })],
      0,
    ]);
  });

  it('logs a ceremony step at debug', () => {
    logAuthStep({ event: 'challenge', method: 'passkey', step: 'challenge-issued' });

    expect(logger.debug).toHaveBeenCalledWith('[Auth] challenge step', expect.objectContaining({ event: 'challenge', outcome: 'step', step: 'challenge-issued' }));
  });

  it('reads the origin from the socket handshake when the request set none', () => {
    vi.mocked(useRequestOrigin).mockReturnValue(undefined);
    vi.mocked(useClient).mockReturnValue({ handshake: { address: '198.51.100.2', headers: { 'user-agent': 'Android WebView' } } } as never);

    logAuthSuccess({ event: 'sign-out', method: 'session-cookie', userId: 'u1' });

    expect(logger.info).toHaveBeenCalledWith('[Auth] sign-out succeeded', expect.objectContaining({ ip: '198.51.100.2', userAgent: 'Android WebView' }));
  });

  it('does nothing, rather than throw, outside a request', () => {
    vi.mocked(useLogger).mockImplementation(() => { throw new Error('required value "logger" is not set in scope'); });

    expect(() => logAuthFailure({ event: 'sign-in', method: 'passkey', reason: 'bad-signature' })).not.toThrow();
  });
});
