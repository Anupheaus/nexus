import { describe, it, expect, beforeAll } from 'vitest';
import { jwt } from './jwt';
import type { NexusUser } from '../common';

describe('jwt', () => {
  const validUser: NexusUser = { id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d' };

  // RSA keypair generation is expensive; do it once and share it so the suite doesn't time out under
  // parallel load (each per-test keygen previously made these tests flaky in the full run).
  let created: Awaited<ReturnType<typeof jwt.createTokenFromUser>>;
  beforeAll(async () => { created = await jwt.createTokenFromUser(validUser); }, 30000);

  describe('createTokenFromUser', () => {
    it('creates a token with user data when no private key provided', () => {
      // `created` is exactly the no-private-key path.
      expect(created.token).toBeDefined();
      expect(typeof created.token).toBe('string');
      expect(created.token.split('.')).toHaveLength(3); // JWT format
      expect(created.publicKey).toBeDefined();
      expect(created.privateKey).toBeDefined();
    });

    it('creates a token when private key is provided', async () => {
      const base64PrivateKey = created.privateKey;
      const pemPrivateKey = Buffer.from(base64PrivateKey, 'base64').toString('utf-8');
      // Signing with a provided key reuses it (no keygen), so this stays fast.
      const result = await jwt.createTokenFromUser(validUser, pemPrivateKey);
      expect(result.token).toBeDefined();
      expect(result.privateKey).toBe(base64PrivateKey);
    });
  });

  describe('extractUserFromToken', () => {
    it('extracts user from valid token', () => {
      const result = jwt.extractUserFromToken(created.token, created.publicKey);
      expect(result).toEqual(validUser);
    });

    it('throws when token is verified with wrong key', () => {
      const wrongKey = Buffer.from('invalid-key').toString('base64');
      expect(() => jwt.extractUserFromToken(created.token, wrongKey)).toThrow();
    });

    it('throws InternalError when token is expired', async () => {
      const pemPrivateKey = Buffer.from(created.privateKey, 'base64').toString('utf-8');

      // Directly sign with the JWT library to create an already-expired token.
      const JWT = (await import('jsonwebtoken')).default;
      const expiredToken = JWT.sign({ user: validUser }, pemPrivateKey, {
        algorithm: 'RS256',
        issuer: 'nexus',
        audience: 'nexus',
        expiresIn: '1ms', // Expire immediately
      });

      // Wait for the token to expire.
      await new Promise(r => setTimeout(r, 10));

      expect(() => jwt.extractUserFromToken(expiredToken, created.publicKey)).toThrow(/expired/i);
    });
  });

  describe('encodePrivateKey', () => {
    it('returns base64 encoded string for non-empty private key', () => {
      const pemKey = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----';
      const result = jwt.encodePrivateKey(pemKey);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(Buffer.from(result!, 'base64').toString('utf-8')).toBe(pemKey);
    });

    it('returns undefined for empty string', () => {
      expect(jwt.encodePrivateKey('')).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(jwt.encodePrivateKey(undefined)).toBeUndefined();
    });
  });
});
