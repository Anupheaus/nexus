# tests — Testing suites and fixtures

Multi-layered testing for a real-time API library: unit tests in `src/`, integration tests with a live server, performance smoke tests, and browser-based Playwright specs.

## Overview

The tests directory contains four separate testing layers:

- **E2E tests** (`e2e/`): Vitest + a real server instance. Tests socket actions, subscriptions, events, and authentication via `socket.io-client`.
- **Harness** (`harness/`): Shared demo app (server + React client) that runs as a test fixture. Powers E2E and perf tests; also used by `pnpm start` (dev server) and `pnpm start:web` (demo app).
- **Performance tests** (`perf/`): Throughput and latency smoke tests. Runs as part of CI.
- **Playwright tests** (`playwright/`): Self-contained browser automation suite with its own Vite-built React app and server. Tests real-browser scenarios (actions, events, subscriptions, connection state, REST mode).
- **Stubs** (`stubs/`): Mock implementations of Capacitor APIs (`@capacitor/app`, `@capacitor/browser`) for unit tests that simulate mobile platform behavior.

## Subdirectories

### `e2e/`

Integration tests using Vitest and a real server. Covers socket-based actions, subscriptions, events, and authentication flows.

- **`TestClient.ts`**: Socket.IO client wrapper for test use. Exposes `request()` and `subscribe()` helpers.
- **`auth.tests.ts`**: JWT authentication, signin/signout, session validation.
- **`rest-actions.tests.ts`**: REST endpoints (fallback/non-socket mode).
- **`socket-api.e2e.tests.ts`**: Main socket tests — actions, subscriptions, connection, re-connection.

When to extend: Add new socket test files here if testing new actions, subscriptions, or authentication modes that require a live server. Do not add more tests to an existing file if they cover a different domain (create `foo.tests.ts` instead of appending to `socket-api.e2e.tests.ts`).

### `harness/`

Shared demo app and test fixtures. Defines the actions, subscriptions, events, and models used across all test layers (E2E, perf, Playwright, dev server).

- **`server/`**: Real Nexus server fixture. `start.ts` bootstraps it; `configureActions.ts` and others define the test contract.
- **`client/`**: React client app (part of the dev server when you run `pnpm start`).
- **`common/`**: Shared types, actions, models, and subscription definitions used everywhere.

When to extend: Update `common/actions.ts` or `common/models.ts` when adding a new action/subscription/event to test. Update `server/configureActions.ts` when adding handler logic for a new action. Do not treat harness as a real app — keep it minimal and demo-focused.

### `perf/`

Performance smoke tests. Measures throughput and latency for key socket operations.

- **`socket-api.perf.tests.ts`**: Throughput and latency benchmarks for actions and subscriptions.

When to extend: Add benchmarks here when a new feature (action, subscription, event) warrants performance monitoring. Use the same pattern: start the harness server, connect a test client, measure wall-clock time or message count.

### `playwright/`

Browser-based automated tests using Playwright. Covers real-browser scenarios including DOM interaction, network resilience, and browser-specific quirks.

- **`specs/`**: Playwright specs (test files). One file per feature.
  - **`connection.spec.ts`**: Socket connection, reconnection, disconnect.
  - **`actions.spec.ts`**: Action request/response lifecycle from the browser.
  - **`subscriptions.spec.ts`**: Subscription lifecycle (subscribe, unsubscribe, updates).
  - **`events.spec.ts`**: Server-to-client events.
  - **`rest-mode.spec.ts`**: REST endpoint mode (WebSocket unavailable).
- **`app/`**: Vite-built React test app. Has its own `index.html` and `main.tsx`. Rendered by Playwright specs.
  - **`ActionSection.tsx`**, **`EventSection.tsx`**, etc.: UI sections that exercise each feature. Specs interact with these.
- **`server/`**: Test server for Playwright. Runs alongside the Vite app during test runs.
- **`tsconfig.server.json`**: TypeScript config for the test server (separate from the app).

When to extend: Add a new spec file in `specs/` for each new feature to test. Update the test app in `app/` to expose UI that exercises the feature (buttons, forms, event listeners). Add a server contract in `server/contracts.ts` if needed.

### `stubs/`

Mock implementations of Capacitor platform APIs.

- **`capacitor-app.ts`**: Stubs `@capacitor/app` (lifecycle events like pause/resume).
- **`capacitor-browser.ts`**: Stubs `@capacitor/browser` (open, close, platform info).

When to extend: If a unit test needs to simulate Capacitor behavior, import these stubs. Do not add logic here — keep stubs minimal and declarative.

## Architecture

### Harness lifecycle

The harness server is started once at the beginning of an E2E or perf test session. All test clients connect to the same server instance via Socket.IO. The shared `configureActions`, `models`, and `actions` definitions ensure test coverage aligns with the real API contract.

The harness is also used by the dev server (`pnpm start`) and the Playwright server during test runs. Keep it simple and schema-faithful.

### Playwright app build

The Playwright test app is built by Vite during test setup. It runs as a separate process from the test server. Specs run in Chromium/Firefox/WebKit and interact with the DOM via Playwright's inspect/click/type helpers.

### Test execution

- **Unit tests** (`pnpm test`): Vitest runs `.tests.ts` files in `src/` only (not in `tests/`).
- **E2E tests** (`pnpm test:e2e`): Starts the harness server, runs Vitest on `tests/e2e/*.tests.ts`.
- **Perf tests** (`pnpm test:perf`): Runs `tests/perf/*.tests.ts` as part of `pnpm test-ci`.
- **Playwright tests** (`pnpm test:playwright`): Builds the Vite app, starts the test server, runs Playwright specs.

### Authentication in tests

- E2E tests use JWT mode by default (configured in `harness/server/start.ts`).
- Harness fixtures include a test user and credentials defined in `harness/common/models.ts`.
- Playwright tests use the same harness server, so auth flows are covered end-to-end from the browser.

## Gotchas

### Adding a new E2E test

1. Create a new file `tests/e2e/myfeature.tests.ts`.
2. Import `TestClient` from `TestClient.ts` and the harness actions/models from `harness/common/`.
3. Start the harness server via the test setup hook (see existing tests for the pattern).
4. Create a `TestClient` instance and call `request()` or `subscribe()` to exercise the action/subscription.

Do not add logic to harness unless the test fixture genuinely needs it.

### Playwright vs. E2E

- **E2E tests** hit the socket API directly via client SDK. They are fast and suitable for unit-like coverage.
- **Playwright tests** render a real browser, click DOM elements, and interact with the app like a user would. They are slower but catch UI bugs, browser quirks, and real-world scenarios that the SDK doesn't test.

If a bug is in the socket layer (action handler, subscription logic, authentication), write an E2E test. If it's in the browser (DOM rendering, click handling, network resilience), write a Playwright spec.

### Stubs and unit tests

The stubs in `stubs/` are imported by unit tests in `src/` to mock Capacitor. Do not run stubs through the test runner — they are import-time declarations, not test files.

### Server contract

The harness server exposes the actions and subscriptions defined in `harness/common/actions.ts` and `models.ts`. These are the *only* things the test client can call. Keep the harness contract minimal; if you need to test a new action, add it to the harness first.
