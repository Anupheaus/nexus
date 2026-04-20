import { describe, it, expect, vi, beforeEach } from 'vitest';
import Router from 'koa-router';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, SocketAPIDeviceDetails } from '../../../common/auth';
import { createWebauthnRegisterRoute } from './webauthnRegisterRoute';

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
    findByRegistrationToken: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    findByKeyHash: vi.fn(async () => undefined),
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
  createWebauthnRegisterRoute(router, 'api', store);
  const ctx = makeCtx(body);
  await handler(ctx);
  return ctx;
}

describe('createWebauthnRegisterRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when registrationToken is missing from body', async () => {
    const ctx = await invokeRoute(makeStore(), { keyHash: 'abc' });
    expect(ctx.status).toBe(400);
  });

  it('returns 404 when no record found for registrationToken', async () => {
    const ctx = await invokeRoute(makeStore(undefined), { registrationToken: 'bad', keyHash: 'abc' });
    expect(ctx.status).toBe(404);
  });

  it('updates record with keyHash, deviceDetails, sessionToken, clears registrationToken', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const ctx = await invokeRoute(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails });
    expect(ctx.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      keyHash: 'hash1',
      deviceDetails,
      sessionToken: expect.any(String),
      isEnabled: true,
      registrationToken: undefined,
    }));
  });

  it('sets HttpOnly session cookie on success', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const ctx = await invokeRoute(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails });
    expect(ctx.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('socketapi_session='));
    expect(ctx.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'));
  });
});
