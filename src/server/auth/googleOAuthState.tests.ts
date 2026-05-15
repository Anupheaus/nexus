import { describe, it, expect } from 'vitest';
import { encodeState, decodeState } from './googleOAuthState';
import type { GoogleOAuthStatePayload } from './googleOAuthState';

const SECRET = 'test-client-secret-abc123';

const payload: GoogleOAuthStatePayload = {
  nonce: 'abc123',
  postAuthUrl: 'https://myapp.com/dashboard',
  platform: 'web',
  popup: true,
};

describe('encodeState / decodeState', () => {
  it('round-trips a payload', () => {
    const encoded = encodeState(payload, SECRET);
    const decoded = decodeState(encoded, SECRET);
    expect(decoded).toEqual(payload);
  });

  it('includes optional scopes when provided', () => {
    const withScopes = { ...payload, scopes: ['https://www.googleapis.com/auth/calendar'] };
    const decoded = decodeState(encodeState(withScopes, SECRET), SECRET);
    expect(decoded.scopes).toEqual(['https://www.googleapis.com/auth/calendar']);
  });

  it('throws on tampered payload', () => {
    const encoded = encodeState(payload, SECRET);
    const [data] = encoded.split('.');
    const tampered = `${data}.invalidsignature1234567890123456789012`;
    expect(() => decodeState(tampered, SECRET)).toThrow('State signature mismatch');
  });

  it('throws when state has no dot separator', () => {
    expect(() => decodeState('nodot', SECRET)).toThrow('Invalid state format');
  });

  it('throws when signed with a different secret', () => {
    const encoded = encodeState(payload, SECRET);
    expect(() => decodeState(encoded, 'wrong-secret')).toThrow('State signature mismatch');
  });

  it('throws Invalid state format for multi-dot state strings', () => {
    const encoded = encodeState(payload, SECRET);
    const [data] = encoded.split('.');
    // Inject an extra dot to create a three-part string
    const multiDot = `${data}.extra.sig`;
    expect(() => decodeState(multiDot, SECRET)).toThrow('Invalid state format');
  });
});
