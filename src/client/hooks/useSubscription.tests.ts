import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { mockReactUISubscribe, mockUnsubscribe, mockOnCallback } = vi.hoisted(() => ({
  mockReactUISubscribe: vi.fn(() => 'sub-id'),
  mockUnsubscribe: vi.fn(),
  mockOnCallback: vi.fn(),
}));

vi.mock('@anupheaus/react-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anupheaus/react-ui')>();
  return {
    ...actual,
    useSubscription: () => ({
      subscribe: mockReactUISubscribe,
      unsubscribe: mockUnsubscribe,
      onCallback: mockOnCallback,
    }),
    useLogger: () => ({ silly: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
    useBound: (fn: unknown) => fn,
  };
});

vi.mock('../providers', () => ({
  Subscription: {},
}));

beforeEach(() => { vi.clearAllMocks(); });

import '@anupheaus/common';
import { defineSubscription } from '../../common';
import { useSubscription } from './useSubscription';

const counterSub = defineSubscription<{ from: number }, number>()('counter');

describe('useSubscription', () => {
  it('returns subscribe, unsubscribe, and onCallback', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    expect(typeof result.current.subscribe).toBe('function');
    expect(typeof result.current.unsubscribe).toBe('function');
    expect(typeof result.current.onCallback).toBe('function');
  });

  it('subscribe passes subscriptionName and request to react-ui subscribe', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    result.current.subscribe({ from: 5 });
    expect(mockReactUISubscribe).toHaveBeenCalledWith(
      { request: { from: 5 }, subscriptionName: 'counter' },
      expect.any(String), // Object.hash default
    );
  });

  it('subscribe uses customHash when provided', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    result.current.subscribe({ from: 0 }, 'my-custom-hash');
    expect(mockReactUISubscribe).toHaveBeenCalledWith(
      { request: { from: 0 }, subscriptionName: 'counter' },
      'my-custom-hash',
    );
  });
});
