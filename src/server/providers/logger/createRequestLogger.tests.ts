import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@anupheaus/common';
import type Koa from 'koa';

vi.mock('../../async-context/nexusContext', () => ({
  useLogger: vi.fn(),
}));

import { useLogger } from '../../async-context/nexusContext';
import { createRequestLogger } from './createRequestLogger';

function makeMockLogger() {
  return {
    silly: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
}

function makeMockCtx(overrides: Partial<{ method: string; path: string; status: number; body: unknown }> = {}) {
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/test',
    status: overrides.status ?? 200,
    body: overrides.body ?? undefined,
  } as unknown as Koa.Context;
}

describe('createRequestLogger', () => {
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    logger = makeMockLogger();
    vi.mocked(useLogger).mockReturnValue(logger as any);
  });

  describe('successful requests', () => {
    it('calls next() and passes its return value through', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx();
      const next = vi.fn().mockResolvedValue('next-result');

      const result = await mw(ctx, next);

      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe('next-result');
    });

    it('logs request start with method and path', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx({ method: 'POST', path: '/api/users' });
      await mw(ctx, vi.fn().mockResolvedValue(undefined));

      expect(logger.silly).toHaveBeenCalledWith(
        'Request started',
        expect.objectContaining({ method: 'POST', path: '/api/users' }),
      );
    });

    it('logs completion with method, path, status, and duration', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx({ method: 'GET', path: '/api/items', status: 200 });
      await mw(ctx, vi.fn().mockResolvedValue(undefined));

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('GET'),
        expect.objectContaining({ method: 'GET', path: '/api/items', status: 200, duration: expect.any(Number) }),
      );
    });

    it('does not call logger.error on a successful request', async () => {
      const mw = createRequestLogger();
      await mw(makeMockCtx(), vi.fn().mockResolvedValue(undefined));
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('ApiError from next()', () => {
    it('sets ctx.status to the ApiError statusCode', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx();
      const apiErr = new ApiError({ message: 'Not Found', statusCode: 404 });
      await mw(ctx, vi.fn().mockRejectedValue(apiErr));

      expect(ctx.status).toBe(404);
    });

    it('sets ctx.body to the ApiError message', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx();
      const apiErr = new ApiError({ message: 'Forbidden', statusCode: 403 });
      await mw(ctx, vi.fn().mockRejectedValue(apiErr));

      expect(ctx.body).toBe('Forbidden');
    });

    it('falls back to status 500 when ApiError has no statusCode', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx();
      const apiErr = new ApiError({ message: 'oops' });
      await mw(ctx, vi.fn().mockRejectedValue(apiErr));

      expect(ctx.status).toBe(500);
    });

    it('logs the error with method, path, and status', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx({ method: 'POST', path: '/api/action' });
      const apiErr = new ApiError({ message: 'Gone', statusCode: 410 });
      await mw(ctx, vi.fn().mockRejectedValue(apiErr));

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('POST'),
        expect.objectContaining({ method: 'POST', path: '/api/action', status: 410 }),
      );
    });

    it('does not call logger.info after an ApiError', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx();
      await mw(ctx, vi.fn().mockRejectedValue(new ApiError({ message: 'err', statusCode: 500 })));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('unexpected errors from next()', () => {
    it('sets ctx.status to 500 for a generic Error', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx();
      await mw(ctx, vi.fn().mockRejectedValue(new globalThis.Error('crash')));

      expect(ctx.status).toBe(500);
    });

    it('sets ctx.body to "Internal server error" for a generic Error', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx();
      await mw(ctx, vi.fn().mockRejectedValue(new globalThis.Error('crash')));

      expect(ctx.body).toBe('Internal server error');
    });

    it('sets ctx.status to 500 for a thrown string', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx();
      await mw(ctx, vi.fn().mockRejectedValue('not-an-error-object'));

      expect(ctx.status).toBe(500);
      expect(ctx.body).toBe('Internal server error');
    });

    it('logs the error with path and status 500', async () => {
      const mw = createRequestLogger();
      const ctx = makeMockCtx({ method: 'DELETE', path: '/api/item/1' });
      await mw(ctx, vi.fn().mockRejectedValue(new globalThis.Error('crash')));

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.objectContaining({ method: 'DELETE', path: '/api/item/1', status: 500 }),
      );
    });
  });
});
