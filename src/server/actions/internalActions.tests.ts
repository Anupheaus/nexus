import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../server';
import { socketAPIAuthenticateTokenAction } from '../../common';
import { jwt } from '../jwt';
import { testPrivateKey } from '../../../tests/harness/server/private-key';
import { TestClient } from '../../../tests/e2e/TestClient';

describe('internalActions — authenticate token', () => {
  let server: http.Server;
  let port: number;
  const socketName = 'internal-actions-test';

  beforeAll(async () => {
    server = http.createServer();
    const logger = new Logger('internal-actions-tests');
    await startServer({
      name: socketName,
      logger,
      server,
      privateKey: testPrivateKey,
      actions: [],
    });
    await new Promise<void>(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  }, 15_000);

  afterAll(() => { server?.close(); });

  it('returns false for a completely invalid token', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    expect(await c.call(socketAPIAuthenticateTokenAction, 'not-a-jwt')).toBe(false);
    c.disconnect();
  });

  it('returns false for an empty string', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    expect(await c.call(socketAPIAuthenticateTokenAction, '')).toBe(false);
    c.disconnect();
  });

  it('returns false for a token signed with a different key than configured', async () => {
    // Create a token with a fresh random key (not testPrivateKey).
    const { token } = await jwt.createTokenFromUser({ id: 'a1b2c3d4-e5f6-4a5b-8c9d-000000000001' });
    const c = new TestClient(port, socketName);
    await c.connect();
    expect(await c.call(socketAPIAuthenticateTokenAction, token)).toBe(false);
    c.disconnect();
  });

  it('returns false for a token where the untrusted user ID does not match the verified user ID', async () => {
    // testPrivateKey is a PEM string — pass it directly to createTokenFromUser.
    const { token: tokenA } = await jwt.createTokenFromUser({ id: 'a1b2c3d4-e5f6-4a5b-8c9d-000000000002' }, testPrivateKey);
    const { token: tokenB } = await jwt.createTokenFromUser({ id: 'a1b2c3d4-e5f6-4a5b-8c9d-000000000003' }, testPrivateKey);

    // Craft a token with header+signature from tokenA but payload from tokenB.
    // The tampered combination has a valid signature but the payload doesn't match the sig.
    const [hA, , sA] = tokenA.split('.');
    const [, pB] = tokenB.split('.');
    const tampered = `${hA}.${pB}.${sA}`;

    const c = new TestClient(port, socketName);
    await c.connect();
    expect(await c.call(socketAPIAuthenticateTokenAction, tampered)).toBe(false);
    c.disconnect();
  });

  it('returns true for a valid token signed with the configured key', async () => {
    // testPrivateKey is a PEM string — pass it directly.
    const { token } = await jwt.createTokenFromUser({ id: 'a1b2c3d4-e5f6-4a5b-8c9d-000000000004' }, testPrivateKey);
    const c = new TestClient(port, socketName);
    await c.connect();
    expect(await c.call(socketAPIAuthenticateTokenAction, token)).toBe(true);
    c.disconnect();
  });
});
