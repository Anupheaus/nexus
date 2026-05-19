/**
 * Unit tests for SubscriptionProvider.
 *
 * Key behaviour under test: onSubscribed awaits registerSubscriptionOnServer(), so errors
 * from socket.emit propagate back to the caller rather than being silently discarded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// ── hoisted mock state ────────────────────────────────────────────────────────
// These variables are mutated inside mock implementations and read in tests.
const hoisted = vi.hoisted(() => {
  let capturedOnSubscribed: ((...args: unknown[]) => Promise<void>) | undefined;
  let capturedOnUnsubscribed: ((...args: unknown[]) => void) | undefined;
  const connectedCallbacks: Array<() => Promise<void>> = [];

  return {
    // Capture helpers — written inside mocks, read in tests
    setOnSubscribed(fn: (...args: unknown[]) => Promise<void>) { capturedOnSubscribed = fn; },
    setOnUnsubscribed(fn: (...args: unknown[]) => void) { capturedOnUnsubscribed = fn; },
    getOnSubscribed() { return capturedOnSubscribed!; },
    getOnUnsubscribed() { return capturedOnUnsubscribed!; },

    // Socket mock controls
    connectedCallbacks,
    mockInvoke: vi.fn<[unknown, string], Promise<void>>(),
    mockEmit: vi.fn<[string, unknown], Promise<unknown>>(),
    mockGetIsConnected: vi.fn<[], boolean>(() => false),
    mockOn: vi.fn(),
  };
});

// ── @anupheaus/react-ui mock ─────────────────────────────────────────────────
// Do NOT use importOriginal — loading the real @anupheaus/react-ui fails in jsdom
// due to a react-icons/fa directory import that Node rejects. Provide only what
// SubscriptionProvider.tsx actually imports from the package.
vi.mock('@anupheaus/react-ui', () => ({
  // Avoid dual-React dispatcher conflict from bundled react-ui instance
  createComponent: (_name: string, fn: unknown) => fn,
  // Silence logger output in tests
  useLogger: () => ({
    silly: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn(),
  }),
  // useBound as a passthrough — stable refs not needed for these tests
  useBound: (fn: unknown) => fn,
  // Capture the onSubscribed / onUnsubscribed callbacks passed to <Provider>
  useSubscriptionProvider: () => ({
    invoke: hoisted.mockInvoke,
    Provider: function MockProvider({
      children,
      onSubscribed,
      onUnsubscribed,
    }: {
      children: React.ReactNode;
      onSubscribed: (...args: unknown[]) => Promise<void>;
      onUnsubscribed: (...args: unknown[]) => void;
    }) {
      hoisted.setOnSubscribed(onSubscribed);
      hoisted.setOnUnsubscribed(onUnsubscribed);
      return <>{children}</>;
    },
  }),
  // useOnMount fires its delegate synchronously in tests (no effects needed)
  useOnMount: (fn: () => void) => { fn(); },
  // useSet / useMap: return real Set / Map instances
  useSet: () => new Set<string>(),
  useMap: <K, V>() => new Map<K, V>(),
}));

// ── ./Subscription mock ───────────────────────────────────────────────────────
// Subscription.ts calls createSubscription from @anupheaus/react-ui which isn't
// in our manual mock. Mock the module directly to avoid that chain.
vi.mock('./Subscription', () => ({
  Subscription: {},
}));

// ── ../socket mock ────────────────────────────────────────────────────────────
vi.mock('../socket', () => ({
  useSocket: () => ({
    on: hoisted.mockOn,
    emit: hoisted.mockEmit,
    getIsConnected: hoisted.mockGetIsConnected,
    onConnected: (cb: () => Promise<void>) => { hoisted.connectedCallbacks.push(cb); },
  }),
}));

// ── import under test (after all mocks) ──────────────────────────────────────
// Import @anupheaus/common to apply its Map/Array prototype augmentations
// (toValuesArray, mapAsync, etc.) which SubscriptionProvider uses at runtime.
import '@anupheaus/common';
import { SubscriptionProvider } from './SubscriptionProvider';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(overrides?: object) {
  return {
    subscriptionName: 'testSub',
    request: { id: '1' },
    ...overrides,
  };
}

/** Renders SubscriptionProvider and returns the captured onSubscribed callback. */
async function renderProvider(): Promise<(...args: unknown[]) => Promise<void>> {
  await act(async () => {
    render(
      <SubscriptionProvider>
        <span />
      </SubscriptionProvider>,
    );
  });
  return hoisted.getOnSubscribed();
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.connectedCallbacks.length = 0;
  hoisted.mockGetIsConnected.mockReturnValue(false);
});

describe('SubscriptionProvider — onSubscribed', () => {
  it('does nothing when hash is null', async () => {
    const onSubscribed = await renderProvider();
    await expect(onSubscribed('hook-1', makeRequest(), vi.fn(), undefined, true)).resolves.toBeUndefined();
    expect(hoisted.mockEmit).not.toHaveBeenCalled();
  });

  it('does nothing when hashIsNew is false', async () => {
    hoisted.mockGetIsConnected.mockReturnValue(true);
    const onSubscribed = await renderProvider();
    await expect(onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', false)).resolves.toBeUndefined();
    expect(hoisted.mockEmit).not.toHaveBeenCalled();
  });

  it('does not emit when socket is disconnected — registers for later', async () => {
    hoisted.mockGetIsConnected.mockReturnValue(false);
    const onSubscribed = await renderProvider();
    await expect(onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', true)).resolves.toBeUndefined();
    expect(hoisted.mockEmit).not.toHaveBeenCalled();
  });

  it('emits subscribe and invokes callback when socket is connected and emit succeeds', async () => {
    hoisted.mockGetIsConnected.mockReturnValue(true);
    const serverResponse = { records: [{ id: '1' }] };
    hoisted.mockEmit.mockResolvedValue({ response: serverResponse, subscriptionId: 'sub-42' });

    const onSubscribed = await renderProvider();
    await act(async () => {
      await onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', true);
    });

    expect(hoisted.mockEmit).toHaveBeenCalledWith(
      'nexus.subscriptions.testSub',
      { request: { id: '1' }, action: 'subscribe', subscriptionId: 'hash-abc' },
    );
    expect(hoisted.mockInvoke).toHaveBeenCalledWith(serverResponse, 'sub-42', true);
  });

  it('does not call invoke when emit response has no response field', async () => {
    hoisted.mockGetIsConnected.mockReturnValue(true);
    hoisted.mockEmit.mockResolvedValue({ subscriptionId: 'sub-42' });

    const onSubscribed = await renderProvider();
    await act(async () => {
      await onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', true);
    });

    expect(hoisted.mockInvoke).not.toHaveBeenCalled();
  });

  it('propagates emit rejection when socket is connected and emit fails', async () => {
    // This test verifies the fix: before the await was added, the error was silently
    // discarded (fire-and-forget). After the fix, onSubscribed rejects with the error.
    hoisted.mockGetIsConnected.mockReturnValue(true);
    hoisted.mockEmit.mockRejectedValue(new Error('socket disconnected'));

    const onSubscribed = await renderProvider();

    await expect(
      act(async () => {
        await onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', true);
      }),
    ).rejects.toThrow('socket disconnected');
  });
});

describe('SubscriptionProvider — onConnected re-registration', () => {
  it('re-registers all subscriptions when socket reconnects', async () => {
    // First subscription registered while disconnected
    hoisted.mockGetIsConnected.mockReturnValue(false);
    const serverResponse = { records: [] };
    hoisted.mockEmit.mockResolvedValue({ response: serverResponse, subscriptionId: 'sub-1' });

    const onSubscribed = await renderProvider();
    await act(async () => {
      await onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', true);
    });
    expect(hoisted.mockEmit).not.toHaveBeenCalled();

    // Now the socket connects — all registered subscriptions should be re-invoked
    await act(async () => {
      await Promise.all(hoisted.connectedCallbacks.map(cb => cb()));
    });

    expect(hoisted.mockEmit).toHaveBeenCalledWith(
      'nexus.subscriptions.testSub',
      expect.objectContaining({ action: 'subscribe', subscriptionId: 'hash-abc' }),
    );
    expect(hoisted.mockInvoke).toHaveBeenCalledWith(serverResponse, 'sub-1', true);
  });

  it('re-registers multiple independent subscriptions on reconnect', async () => {
    hoisted.mockGetIsConnected.mockReturnValue(false);
    hoisted.mockEmit.mockResolvedValue({ response: undefined, subscriptionId: 'sub-x' });

    const onSubscribed = await renderProvider();
    await act(async () => {
      await onSubscribed('hook-1', { subscriptionName: 'subA', request: {} }, vi.fn(), 'hash-1', true);
      await onSubscribed('hook-2', { subscriptionName: 'subB', request: {} }, vi.fn(), 'hash-2', true);
    });
    expect(hoisted.mockEmit).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.all(hoisted.connectedCallbacks.map(cb => cb()));
    });

    const emittedEvents = hoisted.mockEmit.mock.calls.map(c => c[0] as string);
    expect(emittedEvents).toContain('nexus.subscriptions.subA');
    expect(emittedEvents).toContain('nexus.subscriptions.subB');
  });
});

describe('SubscriptionProvider — onUnsubscribed', () => {
  it('emits unsubscribe when hash is destroyed and socket is connected', async () => {
    hoisted.mockGetIsConnected.mockReturnValue(true);
    hoisted.mockEmit.mockResolvedValue({ subscriptionId: 'sub-1' });

    const onSubscribed = await renderProvider();
    await act(async () => {
      await onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', true);
    });

    vi.clearAllMocks();
    hoisted.mockGetIsConnected.mockReturnValue(true);
    hoisted.mockEmit.mockResolvedValue({});

    const onUnsubscribed = hoisted.getOnUnsubscribed();
    await act(async () => { onUnsubscribed('hook-1', 'hash-abc', true); });

    expect(hoisted.mockEmit).toHaveBeenCalledWith(
      'nexus.subscriptions.testSub',
      { action: 'unsubscribe', subscriptionId: 'hash-abc' },
    );
  });

  it('does not emit when hashDestroyed is false', async () => {
    hoisted.mockGetIsConnected.mockReturnValue(true);
    hoisted.mockEmit.mockResolvedValue({ subscriptionId: 'sub-1' });

    const onSubscribed = await renderProvider();
    await act(async () => {
      await onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', true);
    });

    vi.clearAllMocks();
    const onUnsubscribed = hoisted.getOnUnsubscribed();
    await act(async () => { onUnsubscribed('hook-1', 'hash-abc', false); });

    expect(hoisted.mockEmit).not.toHaveBeenCalled();
  });

  it('does not emit when socket is disconnected on unsubscribe', async () => {
    hoisted.mockGetIsConnected.mockReturnValue(true);
    hoisted.mockEmit.mockResolvedValue({ subscriptionId: 'sub-1' });

    const onSubscribed = await renderProvider();
    await act(async () => {
      await onSubscribed('hook-1', makeRequest(), vi.fn(), 'hash-abc', true);
    });

    vi.clearAllMocks();
    hoisted.mockGetIsConnected.mockReturnValue(false);
    const onUnsubscribed = hoisted.getOnUnsubscribed();
    await act(async () => { onUnsubscribed('hook-1', 'hash-abc', true); });

    expect(hoisted.mockEmit).not.toHaveBeenCalled();
  });
});
