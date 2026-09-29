import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Koa from 'koa';
import { createOperatorKeyGuard, findOperatorKeyInRequest, findRefusedKey, MAX_REQUEST_DEPTH, REFUSED_OPERATOR_MESSAGE } from './createOperatorKeyGuard';
import { setLogger } from '../async-context/nexusContext';

const mockLogger: any = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), silly: vi.fn(), debug: vi.fn() };
mockLogger.createSubLogger = () => mockLogger;

const isDollar = (key: string) => key.startsWith('$');

describe('findRefusedKey', () => {
  it('finds nothing in ordinary data', () => {
    expect(findRefusedKey({ id: 'a', items: [{ price: '$10' }], note: 'a.b' }, isDollar)).toBeUndefined();
    expect(findRefusedKey('text', isDollar)).toBeUndefined();
    expect(findRefusedKey(undefined, isDollar)).toBeUndefined();
  });

  it('reports the path to the first refused key, through arrays and null-prototype objects (qs)', () => {
    const qsObject = Object.assign(Object.create(null), { token: Object.assign(Object.create(null), { $ne: 'x' }) });
    expect(findRefusedKey({ list: [{ ok: 1 }, { id: { $in: [] } }] }, isDollar)).toBe('list.1.id.$in');
    expect(findRefusedKey(qsObject, isDollar)).toBe('token.$ne');
  });

  it('refuses a value nested deeper than the limit — and walks a very deep one without overflowing the stack', () => {
    const nest = (depth: number): unknown => { let value: unknown = 'leaf'; for (let level = 0; level < depth; level += 1) value = [value]; return value; };
    expect(findRefusedKey(nest(MAX_REQUEST_DEPTH), isDollar)).toBeUndefined();
    expect(findRefusedKey(nest(MAX_REQUEST_DEPTH + 1), isDollar)).toMatch(/\(nested too deeply\)$/);
    expect(findRefusedKey(nest(250_000), isDollar)).toMatch(/\(nested too deeply\)$/);
  });

  it('never walks into a class instance, and copes with a loop', () => {
    class Holder { public $ne = 1; }
    const looped: Record<string, unknown> = { a: 1 };
    looped.self = looped;
    expect(findRefusedKey({ value: new Holder() }, isDollar)).toBeUndefined();
    expect(findRefusedKey(looped, isDollar)).toBeUndefined();
  });
});

describe('findOperatorKeyInRequest', () => {
  const request = (overrides: Partial<{ path: string; query: Record<string, unknown>; body: unknown }>) =>
    ({ path: '/app/actions/x', method: 'POST', query: {}, body: {}, ...overrides });

  it.each([
    [{ query: { $where: '1' } }, 'query.$where'],
    [{ body: { value: { $ne: null } } }, 'body.value.$ne'],
  ])('refuses %j by default', (overrides, key) => {
    expect(findOperatorKeyInRequest(request(overrides), {})).toBe(key);
  });

  it('lets dotted keys through by default — refusing them is opt-in, so taking this version breaks no webhook', () => {
    expect(findOperatorKeyInRequest(request({ query: { 'hub.mode': 'subscribe' }, body: { 'X.Y': 1 } }), {})).toBeUndefined();
  });

  it.each([
    [{ query: { 'a.b': '1' } }, 'query.a.b'],
    [{ body: { 'items.0.price': 1 } }, 'body.items.0.price'],
  ])('refuses dotted %j once the app opts in', (overrides, key) => {
    expect(findOperatorKeyInRequest(request(overrides), { refuseDottedKeys: true })).toBe(key);
  });

  it('lets an allowed request carry dotted keys, never $ keys', () => {
    const config = { refuseDottedKeys: true, isDottedKeyAllowed: ({ path }: { path: string }) => path.startsWith('/webhooks/') };
    expect(findOperatorKeyInRequest(request({ path: '/webhooks/meta', query: { 'hub.mode': 'subscribe' }, body: { 'X.Y': 1 } }), config)).toBeUndefined();
    expect(findOperatorKeyInRequest(request({ path: '/webhooks/meta', body: { $where: 'x' } }), config)).toBe('body.$where');
    expect(findOperatorKeyInRequest(request({ path: '/app/actions/x', body: { 'X.Y': 1 } }), config)).toBe('body.X.Y');
  });
});

describe('createOperatorKeyGuard', () => {
  beforeEach(() => {
    setLogger(mockLogger as never);
    mockLogger.warn.mockClear();
  });

  const context = (body: unknown, query: Record<string, unknown> = {}) =>
    ({ path: '/app/actions/x', method: 'POST', query, request: { body }, status: 200, body: undefined }) as unknown as Koa.Context;

  it('answers 400 and never calls on', async () => {
    const ctx = context({ id: { $ne: null } });
    const next = vi.fn(async () => undefined);
    await createOperatorKeyGuard({})(ctx, next);
    expect(ctx.status).toBe(400);
    expect(ctx.body).toEqual({ error: { message: REFUSED_OPERATOR_MESSAGE } });
    expect(next).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ securityEvent: 'operator-injection', key: 'body.id.$ne' }));
  });

  it('logs at most 200 characters of the refused key path', async () => {
    const longKey = `$${'x'.repeat(500)}`;
    await createOperatorKeyGuard({})(context({ [longKey]: 1 }), vi.fn(async () => undefined));
    const [, meta] = mockLogger.warn.mock.calls.at(-1)!;
    expect((meta as { key: string }).key.length).toBeLessThanOrEqual(201);
  });

  it('calls on for an ordinary request', async () => {
    const next = vi.fn(async () => undefined);
    await createOperatorKeyGuard({})(context({ id: 'a' }, { page: '1' }), next);
    expect(next).toHaveBeenCalled();
  });

  it('does nothing when turned off', async () => {
    const next = vi.fn(async () => undefined);
    await createOperatorKeyGuard(false)(context({ id: { $ne: null } }), next);
    expect(next).toHaveBeenCalled();
  });
});
