import { describe, it, expect, vi, beforeEach } from 'vitest';
import Router from 'koa-router';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, SocketAPIDeviceDetails } from '../../../common/auth';
import { createWebauthnReauthRoute } from './webauthnReauthRoute';

const deviceDetails: SocketAPIDeviceDetails = {
  userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

function makeStore(record?: Partial<WebAuthnAuthRecord>): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => undefined),
    findByKeyHash: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    update: vi.fn(),
  };
}

function makeCtx(body: Record<string, unknown> = {}) {
  return {
    request: { body },
    status: 0,
    body: undefined as unknown,
    set: vi.fn(),
  };
}

async function invokeRoute(store: WebAuthnAuthStore, body: Record<string, unknown>) {
  let handler: (ctx: any) => Promise<void> = async () => {};
  const router = {
    post: (_path: string, fn: (ctx: any) => Promise<void>) => { handler = fn; },
  } as unknown as Router;
  createWebauthnReauthRoute(router, 'api', store);
  const ctx = makeCtx(body);
  await handler(ctx);
  return ctx;
}

describe('createWebauthnReauthRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when keyHash is missing from body', async () => {
    const ctx = await invokeRoute(makeStore(), {});
    expect(ctx.status).toBe(400);
  });

  it('returns 401 when no record found for keyHash', async () => {
    const ctx = await invokeRoute(makeStore(undefined), { keyHash: 'unknown' });
    expect(ctx.status).toBe(401);
  });

  it('returns 401 when record exists but is disabled', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const ctx = await invokeRoute(store, { keyHash: 'h1' });
    expect(ctx.status).toBe(401);
  });

  it('issues a fresh session token and updates the record on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const ctx = await invokeRoute(store, { keyHash: 'h1', deviceDetails });
    expect(ctx.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      sessionToken: expect.any(String),
      lastConnectedAt: expect.any(Number),
      deviceDetails,
    }));
    const newToken = (store.update as ReturnType<typeof vi.fn>).mock.calls[0][1].sessionToken;
    expect(newToken).not.toBe('old');
  });

  it('sets HttpOnly session cookie on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const ctx = await invokeRoute(store, { keyHash: 'h1' });
    expect(ctx.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('socketapi_session='));
    expect(ctx.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'));
  });
});
