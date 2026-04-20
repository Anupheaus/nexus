import { describe, it, expect, vi, beforeEach } from 'vitest';
import Router from 'koa-router';
import type { WebAuthnAuthStore, WebAuthnAuthRecord } from '../../../common/auth';
import { createWebauthnInviteRoute } from './webauthnInviteRoute';

function makeStore(record?: Partial<WebAuthnAuthRecord>): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => undefined),
    findByKeyHash: vi.fn(async () => undefined),
    update: vi.fn(),
  };
}

function makeCtx(query: Record<string, string> = {}) {
  return {
    query,
    status: 0,
    body: undefined as unknown,
  };
}

async function invokeRoute(
  store: WebAuthnAuthStore,
  onGetUserDetails: (userId: string) => Promise<{ name: string; displayName?: string }>,
  query: Record<string, string>,
) {
  let handler: (ctx: any) => Promise<void> = async () => {};
  const router = {
    get: (_path: string, fn: (ctx: any) => Promise<void>) => { handler = fn; },
  } as unknown as Router;
  createWebauthnInviteRoute(router, 'api', store, onGetUserDetails);
  const ctx = makeCtx(query);
  await handler(ctx);
  return ctx;
}

describe('createWebauthnInviteRoute', () => {
  const onGetUserDetails = vi.fn(async () => ({ name: 'Alice', displayName: 'Alice A' }));

  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when requestId query param is missing', async () => {
    const ctx = await invokeRoute(makeStore(), onGetUserDetails, {});
    expect(ctx.status).toBe(400);
  });

  it('returns 404 when no record found for requestId', async () => {
    const ctx = await invokeRoute(makeStore(undefined), onGetUserDetails, { requestId: 'unknown' });
    expect(ctx.status).toBe(404);
  });

  it('returns 400 when record is already enabled (already registered)', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 't', deviceId: 'd' });
    const ctx = await invokeRoute(store, onGetUserDetails, { requestId: 'r1' });
    expect(ctx.status).toBe(400);
  });

  it('generates registrationToken, stores it, and returns userDetails on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: '', deviceId: '' });
    const ctx = await invokeRoute(store, onGetUserDetails, { requestId: 'r1' });
    expect(ctx.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ registrationToken: expect.any(String) }));
    expect((ctx.body as any).registrationToken).toBeTruthy();
    expect((ctx.body as any).userDetails).toEqual({ name: 'Alice', displayName: 'Alice A' });
  });

  it('calls onGetUserDetails with the record userId', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'user-42', isEnabled: false, sessionToken: '', deviceId: '' });
    await invokeRoute(store, onGetUserDetails, { requestId: 'r1' });
    expect(onGetUserDetails).toHaveBeenCalledWith('user-42');
  });
});
