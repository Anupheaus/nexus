/**
 * Integration tests for the React client API (useAction, useSubscription).
 * Runs against a real socket.io server started in beforeAll.
 * Environment: jsdom (default for src/client/**) — Node.js APIs still available for server setup.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import React, { useState } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { Logger } from '@anupheaus/common';

// With server.deps.inline, @anupheaus/react-ui goes through the same Vite transform as the
// test code, so there is no dual-React instance. We only need the createComponent passthrough
// so component-wrapped fns are usable as plain functions in JSX without a display-name wrapper.
// LoggerProvider and useLogger are NOT overridden: the real LoggerProvider sets LoggerContext,
// which is necessary for useSubscriptionProvider's internal useLogger calls (internal bundle
// references bypass mocked module exports and always call the bundled function directly).
vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
  };
});
import { startServer, createServerActionHandler, createServerSubscription, useAction as useServerAction } from '../server';
import { defineAction, defineSubscription } from '../common';
import { actions } from '../../tests/harness/server/configureActions';
import { Nexus, useAction, useServerActionHandler, useSubscription, useNexus } from './index';

// ─── Contracts defined for this test file ────────────────────────────────────

const echoAction = defineAction<{ value: string; }, { value: string; }>()('echo');
const failingAction = defineAction<void, void>()('clientTestFailing');
const tickSub = defineSubscription<{ intervalMs: number; }, { count: number; }>()('clientTick');
/** Server invokes this on the client via server `useAction`. */
const clientDoublingAction = defineAction<{ n: number; }, { doubled: number; }>()('integrationClientDouble');
/** Client calls this; server uses `useAction` (from `/server`) to ask the client to compute. */
const triggerClientDoubleAction = defineAction<void, { doubled: number; }>()('integrationTriggerClientDouble');

// ─── Server setup ─────────────────────────────────────────────────────────────

let server: http.Server;
let port: number;
const SOCKET_NAME = 'client-test';

function makeStubLogger(): Logger {
  const logger: Logger = {
    info: vi.fn(), debug: vi.fn(), error: vi.fn(),
    silly: vi.fn(), warn: vi.fn(), always: vi.fn(),
    provide: vi.fn((fn: () => unknown) => fn()),
    createSubLogger: vi.fn(function () { return logger; }),
  } as unknown as Logger;
  return logger;
}

// Mock logger for server startup — avoids @anupheaus/common Logger browser detection (window defined in jsdom).
const serverLogger = makeStubLogger();
// Mock logger for the client Nexus — provided so LoggerProvider has a concrete logger
// without instantiating @anupheaus/common's Logger (which may behave differently in jsdom).
const clientLogger = makeStubLogger();

beforeAll(async () => {
  server = http.createServer();
  await startServer({
    name: SOCKET_NAME,
    logger: serverLogger,
    server,
    actions: [
      ...actions,
      createServerActionHandler(echoAction, async ({ value }) => ({ value })),
      createServerActionHandler(failingAction as never, async () => { throw new Error('server-side failure'); }),
      createServerActionHandler(triggerClientDoubleAction, async () => {
        const askClient = useServerAction(clientDoublingAction);
        return askClient({ n: 21 });
      }),
    ],
    subscriptions: [
      createServerSubscription(tickSub, async ({ request, update, onUnsubscribe }) => {
        let count = 0;
        const interval = setInterval(() => { count++; update({ count }); }, request.intervalMs);
        onUnsubscribe(() => clearInterval(interval));
        return { count: 0 };
      }),
    ],
  });
  await new Promise<void>(resolve => {
    server.listen(0, () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
}, 15000);

afterAll(() => { server?.close(); });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode; }) {
  return (
    <Nexus name={SOCKET_NAME} host={`localhost:${port}`} logger={clientLogger}>
      {children}
    </Nexus>
  );
}

/** Waits until the socket is connected (max 5 s). */
function WaitForConnect({ onConnected }: { onConnected: () => void; }) {
  const { onConnectionStateChanged } = useNexus();
  onConnectionStateChanged(connected => { if (connected) onConnected(); });
  return null;
}

function waitForConnect(): { element: React.ReactElement; connected: Promise<void>; } {
  let resolve!: () => void;
  const connected = new Promise<void>(r => { resolve = r; });
  return { element: <WaitForConnect onConnected={resolve} />, connected };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Nexus React client integration', () => {
  describe('useAction — imperative call', () => {
    it('calls action and returns typed response', async () => {
      const { element: connector, connected } = waitForConnect();

      function TestComponent() {
        const { echo } = useAction(echoAction);
        const [result, setResult] = useState<string>();
        return (
          <>
            {connector}
            <button onClick={async () => setResult((await echo({ value: 'hello' })).value)}>go</button>
            {result != null && <span data-testid="result">{result}</span>}
          </>
        );
      }

      const { unmount } = render(<Wrapper><TestComponent /></Wrapper>);
      await connected;

      await act(async () => {
        screen.getByRole('button').click();
      });

      await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('hello'));
      unmount();
    });

    it('surfaces server-side errors as thrown exceptions', async () => {
      const { element: connector, connected } = waitForConnect();
      const caughtErrors: string[] = [];

      function TestComponent() {
        const { clientTestFailing } = useAction(failingAction as never) as unknown as { clientTestFailing: () => Promise<void>; };
        return (
          <>
            {connector}
            <button onClick={() => clientTestFailing().catch(e => caughtErrors.push(String(e)))}>go</button>
          </>
        );
      }

      const { unmount } = render(<Wrapper><TestComponent /></Wrapper>);
      await connected;

      await act(async () => { screen.getByRole('button').click(); });
      await waitFor(() => expect(caughtErrors.length).toBeGreaterThan(0));
      expect(caughtErrors[0]).toContain('server-side failure');
      unmount();
    });
  });

  describe('server useAction / useServerActionHandler (server → client RPC)', () => {
    it('server invokes client action and returns typed response', async () => {
      const { element: connector, connected } = waitForConnect();

      function TestComponent() {
        useServerActionHandler(clientDoublingAction)(({ n }) => ({ doubled: n * 2 }));
        const { integrationTriggerClientDouble } = useAction(triggerClientDoubleAction);
        const [result, setResult] = useState<number>();
        return (
          <>
            {connector}
            <button type="button" aria-label="trigger-client-rpc" onClick={async () => setResult((await integrationTriggerClientDouble()).doubled)}>go</button>
            {result != null && <span data-testid="client-rpc-result">{result}</span>}
          </>
        );
      }

      const { unmount } = render(<Wrapper><TestComponent /></Wrapper>);
      await connected;

      await act(async () => {
        screen.getByRole('button', { name: 'trigger-client-rpc' }).click();
      });

      await waitFor(() => expect(screen.getByTestId('client-rpc-result').textContent).toBe('42'));
      unmount();
    });

    it('throws when two components register useServerActionHandler for the same action', () => {
      function DupeA() {
        useServerActionHandler(clientDoublingAction)(() => ({ doubled: 0 }));
        return null;
      }
      function DupeB() {
        useServerActionHandler(clientDoublingAction)(() => ({ doubled: 1 }));
        return null;
      }
      expect(() => {
        act(() => {
          render(
            <Wrapper>
              <DupeA />
              <DupeB />
            </Wrapper>,
          );
        });
      }).toThrow(/Only one useServerActionHandler/);
    });
  });

  describe('useAction — reactive (use${Name}) form', () => {
    it('transitions from isLoading to response', async () => {
      function TestComponent() {
        const { useEcho } = useAction(echoAction);
        const { response, isLoading } = useEcho({ value: 'reactive-test' });
        return (
          <span data-testid="state">
            {isLoading ? 'loading' : response?.value ?? 'empty'}
          </span>
        );
      }

      const { unmount } = render(<Wrapper><TestComponent /></Wrapper>);
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('reactive-test'), { timeout: 5000 });
      unmount();
    });

    it('re-fetches when the request value changes (P2 fix)', async () => {
      function TestComponent() {
        const [value, setValue] = useState('first');
        const { useEcho } = useAction(echoAction);
        const { response, isLoading } = useEcho({ value });
        return (
          <>
            <button type="button" aria-label="change-request" onClick={() => setValue('second')}>change</button>
            <span data-testid="loading">{isLoading ? 'loading' : 'done'}</span>
            <span data-testid="value">{response?.value ?? ''}</span>
          </>
        );
      }

      const { unmount } = render(<Wrapper><TestComponent /></Wrapper>);
      await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('first'), { timeout: 5000 });

      await act(async () => { screen.getByRole('button', { name: 'change-request' }).click(); });
      // Should reset to loading then resolve with the new value.
      await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('second'), { timeout: 5000 });
      unmount();
    });

    it('exposes error state when the server throws', async () => {
      function TestComponent() {
        const { useClientTestFailing } = useAction(failingAction as never) as unknown as {
          useClientTestFailing: () => { response: unknown; error: Error | undefined; isLoading: boolean; };
        };
        const { error, isLoading } = useClientTestFailing();
        return (
          <span data-testid="err">
            {isLoading ? 'loading' : error ? error.message : 'none'}
          </span>
        );
      }

      const { unmount } = render(<Wrapper><TestComponent /></Wrapper>);
      await waitFor(() => expect(screen.getByTestId('err').textContent).not.toBe('loading'), { timeout: 5000 });
      expect(screen.getByTestId('err').textContent).toContain('server-side failure');
      unmount();
    });
  });

  describe('useSubscription', () => {
    it('returns initial response on subscribe', async () => {
      const { element: connector, connected } = waitForConnect();

      function TestComponent() {
        const { subscribe, onCallback } = useSubscription(tickSub);
        const [count, setCount] = useState<number>();
        onCallback(({ count: c }) => setCount(c));
        return (
          <>
            {connector}
            <button type="button" aria-label="subscribe-tick" onClick={() => subscribe({ intervalMs: 100 })}>sub</button>
            {count != null && <span data-testid="count">{count}</span>}
          </>
        );
      }

      const { unmount } = render(<Wrapper><TestComponent /></Wrapper>);
      await connected;

      await act(async () => { screen.getByRole('button', { name: 'subscribe-tick' }).click(); });
      // Initial count is 0
      await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'), { timeout: 5000 });
      unmount();
    });

    it('receives streaming updates after subscribe', async () => {
      const { element: connector, connected } = waitForConnect();

      function TestComponent() {
        const { subscribe, onCallback } = useSubscription(tickSub);
        const [counts, setCounts] = useState<number[]>([]);
        onCallback(({ count: c }) => setCounts(prev => [...prev, c]));
        return (
          <>
            {connector}
            <button type="button" aria-label="subscribe-tick-stream" onClick={() => subscribe({ intervalMs: 50 })}>sub</button>
            <span data-testid="count">{counts.length}</span>
          </>
        );
      }

      const { unmount } = render(<Wrapper><TestComponent /></Wrapper>);
      await connected;

      await act(async () => { screen.getByRole('button', { name: 'subscribe-tick-stream' }).click(); });
      await waitFor(() => expect(Number(screen.getByTestId('count').textContent)).toBeGreaterThanOrEqual(3), { timeout: 5000 });
      unmount();
    });
  });
});
