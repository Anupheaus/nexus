import { describe, it, expect } from 'vitest';
import { toRestOrigin } from './toRestOrigin';

describe('toRestOrigin', () => {
  it('is empty (page-relative REST) when no host is configured', () => {
    expect(toRestOrigin({ host: undefined, pageProtocol: 'https:' })).toBe('');
  });

  it('targets the socket host over https on an https page', () => {
    expect(toRestOrigin({ host: 'raynesway-blinds-dev.lintex.co.uk', pageProtocol: 'https:' })).toBe('https://raynesway-blinds-dev.lintex.co.uk');
  });

  it('strips a ws/wss scheme the same way the socket URL does', () => {
    expect(toRestOrigin({ host: 'wss://tenant.example.com', pageProtocol: 'https:' })).toBe('https://tenant.example.com');
    expect(toRestOrigin({ host: 'ws://localhost:3010', pageProtocol: 'http:' })).toBe('http://localhost:3010');
  });

  it('keeps a port', () => {
    expect(toRestOrigin({ host: 'localhost:8443', pageProtocol: 'https:' })).toBe('https://localhost:8443');
  });
});
