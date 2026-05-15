import crypto from 'crypto';

export interface GoogleOAuthStatePayload {
  nonce: string;
  postAuthUrl: string;
  platform: 'web' | 'capacitor';
  popup: boolean;
  scopes?: string[];
}

function sign(encoded: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
}

export function encodeState(payload: GoogleOAuthStatePayload, clientSecret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(encoded, clientSecret);
  return `${encoded}.${sig}`;
}

export function decodeState(state: string, clientSecret: string): GoogleOAuthStatePayload {
  const dotIdx = state.indexOf('.');
  // The format is always exactly <base64url>.<base64url> — exactly one dot separator.
  if (dotIdx === -1 || state.indexOf('.') !== state.lastIndexOf('.')) throw new Error('Invalid state format');

  const encoded = state.slice(0, dotIdx);
  const receivedSig = state.slice(dotIdx + 1);
  const expectedSig = sign(encoded, clientSecret);

  // Hash both signatures before comparing so the buffers are always equal-length (32 bytes),
  // regardless of how long receivedSig is — eliminates the length side-channel.
  const aHash = crypto.createHmac('sha256', clientSecret).update(receivedSig).digest();
  const bHash = crypto.createHmac('sha256', clientSecret).update(expectedSig).digest();
  if (!crypto.timingSafeEqual(aHash, bHash)) {
    throw new Error('State signature mismatch');
  }

  // Safe: data originates from encodeState in this same system — the JSON shape is controlled.
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as GoogleOAuthStatePayload;
}
