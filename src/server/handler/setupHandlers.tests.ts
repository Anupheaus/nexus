import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDebug = vi.fn();
const mockLogger = { debug: mockDebug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../async-context/socketApiContext', () => ({
  useLogger: () => mockLogger,
}));

import { setupHandlers } from './setupHandlers';

describe('setupHandlers', () => {
  beforeEach(() => {
    mockDebug.mockClear();
  });

  it('does nothing when the handlers array is empty', () => {
    expect(() => setupHandlers([])).not.toThrow();
    expect(mockDebug).not.toHaveBeenCalled();
  });

  it('calls each handler exactly once', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    setupHandlers([h1, h2]);
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('calls handlers in order', () => {
    const order: number[] = [];
    const h1 = vi.fn(() => { order.push(1); });
    const h2 = vi.fn(() => { order.push(2); });
    const h3 = vi.fn(() => { order.push(3); });
    setupHandlers([h1, h2, h3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('logs debug messages when handlers are present', () => {
    setupHandlers([vi.fn()]);
    expect(mockDebug).toHaveBeenCalledTimes(2);
    expect(mockDebug).toHaveBeenCalledWith('Setting up handlers...');
    expect(mockDebug).toHaveBeenCalledWith('Handlers set up.');
  });

  it('propagates a throw from a handler and stops executing subsequent handlers', () => {
    const h1 = vi.fn(() => { throw new Error('boom'); });
    const h2 = vi.fn();
    expect(() => setupHandlers([h1, h2])).toThrow('boom');
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).not.toHaveBeenCalled();
  });
});
