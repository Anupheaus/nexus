import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { createServerActionHandler } from './createServerActionHandler';
import { defineAction } from '../../common';
import { startServer } from '../../server';
import { TestClient } from '../../../tests/e2e/TestClient';

// ─── Contract definitions (unique names to avoid module-level Set collision) ──

const handlerEchoAction = defineAction<{ v: string }, { v: string }>()('handlerEcho');
const handlerErrorAction = defineAction<void, void>()('handlerError');
const handlerCountAction = defineAction<void, { n: number }>()('handlerCount');

describe('createServerActionHandler — integration', () => {
  let server: http.Server;
  let port: number;
  const socketName = 'handler-test';
  let callCount = 0;

  const handler = vi.fn(async ({ v }: { v: string }) => ({ v }));
  const errorHandler = vi.fn(async () => { throw new Error('handler-threw'); });
  const countHandler = vi.fn(async () => { callCount++; return { n: callCount }; });

  beforeAll(async () => {
    server = http.createServer();
    const logger = new Logger('handler-tests');
    await startServer({
      name: socketName,
      logger,
      server,
      actions: [
        createServerActionHandler(handlerEchoAction, handler),
        createServerActionHandler(handlerErrorAction, errorHandler as never),
        createServerActionHandler(handlerCountAction, countHandler),
      ],
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

  it('invokes the handler with the request payload and returns the response', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    const result = await c.call(handlerEchoAction, { v: 'hello' });
    expect(result).toEqual({ v: 'hello' });
    expect(handler).toHaveBeenCalledWith({ v: 'hello' });
    c.disconnect();
  });

  it('passes through different request values correctly', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    expect(await c.call(handlerEchoAction, { v: 'alpha' })).toEqual({ v: 'alpha' });
    expect(await c.call(handlerEchoAction, { v: 'beta' })).toEqual({ v: 'beta' });
    c.disconnect();
  });

  it('handler is called exactly once per client call', async () => {
    handler.mockClear();
    const c = new TestClient(port, socketName);
    await c.connect();
    await c.call(handlerEchoAction, { v: 'x' });
    expect(handler).toHaveBeenCalledTimes(1);
    c.disconnect();
  });

  it('multiple sequential calls all invoke the handler', async () => {
    const before = callCount;
    const c = new TestClient(port, socketName);
    await c.connect();
    await c.call(handlerCountAction);
    await c.call(handlerCountAction);
    await c.call(handlerCountAction);
    expect(callCount).toBe(before + 3);
    c.disconnect();
  });

  it('error thrown in handler reaches client as an error — only the message is exposed', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    await expect(c.call(handlerErrorAction as never)).rejects.toThrow('handler-threw');
    c.disconnect();
  });

  it('concurrent calls from different clients do not interfere', async () => {
    const clients = Array.from({ length: 5 }, () => new TestClient(port, socketName));
    await Promise.all(clients.map(cl => cl.connect()));
    const results = await Promise.all(clients.map((cl, i) => cl.call(handlerEchoAction, { v: `c${i}` })));
    results.forEach((r, i) => expect(r).toEqual({ v: `c${i}` }));
    clients.forEach(cl => cl.disconnect());
  });
});

// ─── Factory unit tests ───────────────────────────────────────────────────────

describe('createServerActionHandler — factory', () => {
  it('returns a registration function for the action', () => {
    const action = defineAction<{ id: string }, { success: boolean }>()('factoryTestAction');
    const handler = vi.fn(async () => ({ success: true }));
    const register = createServerActionHandler(action, handler);
    expect(register).toBeInstanceOf(Function);
  });
});
