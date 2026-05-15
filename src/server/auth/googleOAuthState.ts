import crypto from 'crypto';

export interface GoogleOAuthStatePayload {
  nonce: string;
  postAuthUrl: string;
  platform: 'web' | 'capacitor';
  popup: boolean;
  scopes?: string[];
}

// HMAC-SHA256 in base64url — always produces a 43-character string
const HMAC_SIG_LENGTH = 43;

function sign(encoded: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
}

export function encodeState(payload: GoogleOAuthStatePayload, clientSecret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(encoded, clientSecret);
  return `${encoded}.${sig}`;
}

export function decodeState(state: string, clientSecret: string): GoogleOAuthStatePayload {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) throw new Error('Invalid state format');

  const encoded = state.slice(0, dotIdx);
  const receivedSig = state.slice(dotIdx + 1);
  const expectedSig = sign(encoded, clientSecret);

  // Pad to equal length before timing-safe compare (base64url HMAC-SHA256 is always 43 chars)
  const a = Buffer.from(receivedSig.padEnd(HMAC_SIG_LENGTH, '='));
  const b = Buffer.from(expectedSig.padEnd(HMAC_SIG_LENGTH, '='));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('State signature mismatch');
  }

  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as GoogleOAuthStatePayload;
}
