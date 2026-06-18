import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../async-context/nexusContext', () => ({ useLogger: vi.fn() }));

import { useLogger } from '../async-context/nexusContext';
import { securityWarn } from './securityLog';

describe('securityWarn', () => {
  const warn = vi.fn();

  const createSubLogger = vi.fn(() => ({ warn }));

  beforeEach(() => {
    warn.mockClear();
    createSubLogger.mockClear();
    vi.mocked(useLogger).mockReturnValue({ createSubLogger } as never);
  });

  it('logs the warning through a "Nexus Security" sub-logger with the message and meta', () => {
    securityWarn('Rate limit exceeded', { securityEvent: 'rate-limit', scope: 'action', ip: '1.2.3.4' });
    expect(createSubLogger).toHaveBeenCalledWith('Nexus Security');
    expect(warn).toHaveBeenCalledWith('Rate limit exceeded', { securityEvent: 'rate-limit', scope: 'action', ip: '1.2.3.4' });
  });

  it('propagates (does not swallow) if no logger is in scope', () => {
    vi.mocked(useLogger).mockImplementation(() => { throw new Error('required value "logger" is not set in scope'); });
    expect(() => securityWarn('CORS blocked', { securityEvent: 'cors-origin-blocked' })).toThrow();
  });
});
