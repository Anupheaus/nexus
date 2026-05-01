import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDebug = vi.fn();
const mockLogger = { debug: mockDebug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../async-context/socketApiContext', () => ({
  useLogger: () => mockLogger,
}));

import { setupHandlers } from './setupHandlers';

describe('setupHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when the handlers array is empty', () => {
    expect(() => setupHandlers([])).not.toThrow();
    expect(mockDebug).not.toHaveBeenCalled();
  });

  it('calls registerSocket on each handler exactly once', () => {
    const h1 = { registerSocket: vi.fn() };
    const h2 = { registerSocket: vi.fn() };
    setupHandlers([h1, h2]);
    expect(h1.registerSocket).toHaveBeenCalledOnce();
    expect(h2.registerSocket).toHaveBeenCalledOnce();
  });

  it('calls handlers in order', () => {
    const order: number[] = [];
    const h1 = { registerSocket: vi.fn(() => { order.push(1); }) };
    const h2 = { registerSocket: vi.fn(() => { order.push(2); }) };
    const h3 = { registerSocket: vi.fn(() => { order.push(3); }) };
    setupHandlers([h1, h2, h3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('logs debug messages when handlers are present', () => {
    setupHandlers([{ registerSocket: vi.fn() }]);
    expect(mockDebug).toHaveBeenNthCalledWith(1, 'Setting up handlers...');
    expect(mockDebug).toHaveBeenNthCalledWith(2, 'Handlers set up.');
  });

  it('propagates a throw from a handler and stops executing subsequent handlers', () => {
    const h1 = { registerSocket: vi.fn(() => { throw new Error('boom'); }) };
    const h2 = { registerSocket: vi.fn() };
    expect(() => setupHandlers([h1, h2])).toThrow('boom');
    expect(h1.registerSocket).toHaveBeenCalledOnce();
    expect(h2.registerSocket).not.toHaveBeenCalled();
  });
});
