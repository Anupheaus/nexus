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
const userSub = defineSubscription<{ from: number }, string>()('user');

function capturedHash(): string {
  return mockReactUISubscribe.mock.calls[mockReactUISubscribe.mock.calls.length - 1][1] as string;
}

describe('useSubscription — shape', () => {
  it('returns subscribe, unsubscribe, and onCallback', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    expect(typeof result.current.subscribe).toBe('function');
    expect(typeof result.current.unsubscribe).toBe('function');
    expect(typeof result.current.onCallback).toBe('function');
  });

  it('subscribe forwards subscriptionName and request as first arg', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    result.current.subscribe({ from: 5 });
    expect(mockReactUISubscribe).toHaveBeenCalledWith(
      { request: { from: 5 }, subscriptionName: 'counter' },
      expect.any(String),
    );
  });
});

describe('useSubscription — customHash', () => {
  it('passes customHash as-is when provided', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    result.current.subscribe({ from: 0 }, 'my-custom-hash');
    expect(capturedHash()).toBe('my-custom-hash');
  });

  it('uses computed hash when customHash is omitted', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    result.current.subscribe({ from: 0 });
    expect(typeof capturedHash()).toBe('string');
    expect(capturedHash().length).toBeGreaterThan(0);
  });
});

describe('useSubscription — default hash uniqueness', () => {
  it('different subscription names with same request produce different hashes', () => {
    const { result: r1 } = renderHook(() => useSubscription(counterSub));
    const { result: r2 } = renderHook(() => useSubscription(userSub));

    r1.current.subscribe({ from: 0 });
    const hash1 = capturedHash();

    r2.current.subscribe({ from: 0 });
    const hash2 = capturedHash();

    expect(hash1).not.toBe(hash2);
  });

  it('same subscription with different requests produces different hashes', () => {
    const { result } = renderHook(() => useSubscription(counterSub));

    result.current.subscribe({ from: 0 });
    const hash1 = capturedHash();

    result.current.subscribe({ from: 99 });
    const hash2 = capturedHash();

    expect(hash1).not.toBe(hash2);
  });

  it('same subscription with same request produces the same hash on repeated calls', () => {
    const { result } = renderHook(() => useSubscription(counterSub));

    result.current.subscribe({ from: 42 });
    const hash1 = capturedHash();

    result.current.subscribe({ from: 42 });
    const hash2 = capturedHash();

    expect(hash1).toBe(hash2);
  });

  it('customHash overrides the computed hash — two calls with different requests but same customHash share one hash', () => {
    const { result } = renderHook(() => useSubscription(counterSub));

    result.current.subscribe({ from: 0 }, 'stable-key');
    const hash1 = capturedHash();

    result.current.subscribe({ from: 99 }, 'stable-key');
    const hash2 = capturedHash();

    expect(hash1).toBe('stable-key');
    expect(hash2).toBe('stable-key');
  });
});
