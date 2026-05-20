import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockOn, mockOff, mockReconnect, mockConnect, mockDisconnect, mockGetCurrentUser, mockGetIsConnected, mockGetRawSocket, mockGoogleOAuthConfig } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockReconnect: vi.fn(),
  mockConnect: vi.fn(() => Promise.resolve()),
  mockDisconnect: vi.fn(() => Promise.resolve()),
  mockGetCurrentUser: vi.fn(() => undefined as any),
  mockGetIsConnected: vi.fn(() => false),
  mockGetRawSocket: vi.fn(() => null),
  // Default: reject so signIn falls through to WebAuthn (simulates non-Google server).
  mockGoogleOAuthConfig: vi.fn().mockRejectedValue(new Error('not-google-mode')),
}));

vi.mock('../providers/socket/SocketContext', () => {
  const ctx = React.createContext({
    name: 'test',
    reconnect: mockReconnect,
    connect: mockConnect,
    disconnect: mockDisconnect,
    on: mockOn,
    off: mockOff,
    getSocket: vi.fn(),
    getRawSocket: vi.fn(),
    onConnectionStateChanged: vi.fn(),
    onExclusive: vi.fn(),
  } as any);
  return { SocketContext: ctx };
});

// Mock providers barrel so SocketProvider (which needs createComponent) is never loaded.
vi.mock('../providers', () => ({
  useSocket: () => ({
    emit: vi.fn(),
    getIsConnected: mockGetIsConnected,
    getRawSocket: mockGetRawSocket,
    onConnected: vi.fn(),
    on: mockOn,
    off: mockOff,
    onConnectionStateChanged: vi.fn(),
  }),
}));

// Intercept useAction so googleOAuthConfig never goes through fetch in these tests.
vi.mock('../hooks', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    useAction: (action: { name: string }) => {
      if (action.name === 'googleOAuthConfig') {
        return { googleOAuthConfig: mockGoogleOAuthConfig, isConnected: () => false };
      }
      return (actual.useAction as (a: unknown) => unknown)(action);
    },
  };
});

vi.mock('@anupheaus/react-ui', () => ({
  useDistributedState: () => ({ get: mockGetCurrentUser, getAndObserve: vi.fn() }),
  useBound: (fn: unknown) => fn,
  useForceUpdate: () => vi.fn(),
}));

vi.mock('./collectDeviceDetails', () => ({
  collectDeviceDetails: vi.fn(() => ({
    userAgent: 'test', platform: 'test', language: 'en',
    hardwareConcurrency: 4, maxTouchPoints: 0, vendor: 'test',
    screenWidth: 1920, screenHeight: 1080, viewportWidth: 1920,
    viewportHeight: 1080, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
  })),
}));

// ── global browser API mocks ──────────────────────────────────────────────────
const mockFetch = vi.fn();
const mockCredentialsCreate = vi.fn();
const mockCredentialsGet = vi.fn();
const mockDigest = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(0xab).buffer));

beforeAll(() => {
  vi.stubGlobal('fetch', mockFetch);
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      credentials: { create: mockCredentialsCreate, get: mockCredentialsGet },
    },
  });
  Object.defineProperty(global, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: (arr: Uint8Array) => arr.fill(1),
      subtle: { digest: mockDigest },
    },
  });
});

function makeMockCredential() {
  return {
    getClientExtensionResults: () => ({
      prf: { results: { first: new Uint8Array([1, 2, 3, 4]).buffer } },
    }),
  } as unknown as PublicKeyCredential;
}

function setLocationSearch(search: string) {
  delete (window as any).location;
  (window as any).location = { search, href: `http://localhost/${search}`, hostname: 'localhost' };
}

import { useAuthentication } from './useAuthentication';

describe('client useAuthentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocationSearch('');
  });

  // ── original tests ────────────────────────────────────────────────────────

  it('user is undefined initially', () => {
    const { result } = renderHook(() => useAuthentication());
    expect(result.current.user).toBeUndefined();
  });

  it('exposes signIn and signOut functions', () => {
    const { result } = renderHook(() => useAuthentication());
    expect(typeof result.current.signIn).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
  });

  it('registers an event listener via on during render', () => {
    renderHook(() => useAuthentication());
    expect(mockOn).toHaveBeenCalledWith(
      'nexus.events.socketAPIUserChanged',
      expect.any(Function),
    );
  });

  it('does not re-render when user changes and user was not accessed', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useAuthentication();
    });
    const initialCount = renderCount;
    expect(typeof result.current.signOut).toBe('function');
    expect(renderCount).toBe(initialCount);
  });

  it('accessing user enables the reactive re-render flag', () => {
    const { result } = renderHook(() => useAuthentication());
    const _user = result.current.user;
    expect(_user).toBeUndefined();
  });

  it('user is pre-populated from getCurrentUser when a session cookie exists at mount', () => {
    mockGetCurrentUser.mockReturnValueOnce({ id: 'u1', name: 'Alice' } as any);
    const { result } = renderHook(() => useAuthentication());
    expect(result.current.user).toEqual({ id: 'u1', name: 'Alice' });
  });

  // ── signOut ───────────────────────────────────────────────────────────────

  it('signOut calls the signout endpoint and reconnects', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(null) });
    const { result } = renderHook(() => useAuthentication());
    await act(async () => { await result.current.signOut(); });
    expect(mockFetch).toHaveBeenCalledWith(
      '/test/socketAPI/signout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(mockReconnect).toHaveBeenCalled();
  });

  // ── unmount cleanup ───────────────────────────────────────────────────────

  it('does not throw on unmount', () => {
    const { unmount } = renderHook(() => useAuthentication());
    expect(() => unmount()).not.toThrow();
  });

  // ── signIn — JWT branch ───────────────────────────────────────────────────

  describe('signIn with credentials (JWT)', () => {
    it('posts to the signin endpoint with credentials and device info, then reconnects', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
      const { result } = renderHook(() => useAuthentication<any, any, any>());
      await act(async () => { await result.current.signIn({ email: 'a@b.com' }); });
      expect(mockFetch).toHaveBeenCalledWith(
        '/test/socketAPI/signin',
        expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
      );
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.credentials.email).toBe('a@b.com');
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('throws when the signin endpoint returns a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });
      const { result } = renderHook(() => useAuthentication<any, any, any>());
      await expect(
        act(async () => { await result.current.signIn({ email: 'bad@b.com' }); }),
      ).rejects.toThrow();
    });
  });

  // ── signIn — WebAuthn registration branch ─────────────────────────────────

  describe('signIn without credentials + ?requestId (WebAuthn registration)', () => {
    beforeEach(() => {
      setLocationSearch('?requestId=test-req-id-123');
      Object.defineProperty(window.history, 'replaceState', {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    });

    it('fetches invite, creates passkey, posts to register endpoint, removes ?requestId, and reconnects', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ registrationToken: 'reg-token-abc', inviteDetails: { id: 'test-rp-id', appName: 'TestApp', userName: 'alice' } }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ userId: 'u1' }) });
      mockCredentialsCreate.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());
      await act(async () => { await (result.current.signIn as any)(); });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/invite?requestId=test-req-id-123'),
        expect.objectContaining({ credentials: 'include' }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/register'),
        expect.objectContaining({ method: 'POST' }),
      );
      const registerBody = JSON.parse((mockFetch.mock.calls[1]![1] as RequestInit).body as string);
      expect(registerBody.registrationToken).toBe('reg-token-abc');
      expect(typeof registerBody.keyHash).toBe('string');
      expect(registerBody.keyHash).toHaveLength(64);
      expect(window.history.replaceState).toHaveBeenCalled();
      const replacedUrl = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
      expect(replacedUrl).not.toContain('requestId');
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('uses REST for the register endpoint even when the socket connects during the passkey ceremony', async () => {
      // Invite is called before the socket connects; the socket connects while the user
      // saves the passkey; register is called after — resolveTransport must still pick REST.
      // Socket not yet connected for invite; connects while user saves passkey; connected by register
      mockGetIsConnected.mockReturnValueOnce(false).mockReturnValueOnce(true);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ registrationToken: 'reg-token-abc', inviteDetails: { id: 'test-rp-id', appName: 'TestApp', userName: 'alice' } }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ userId: 'u1' }) });
      mockCredentialsCreate.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());
      await act(async () => { await (result.current.signIn as any)(); });

      // Both invite and register must go via REST (fetch), not socket
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/register'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws when the invite fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) });
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('REST action failed: 404');
    });

    it('throws when navigator.credentials.create returns null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ registrationToken: 'tok', inviteDetails: { id: 'test-rp-id', appName: 'TestApp', userName: 'alice' } }),
      });
      mockCredentialsCreate.mockResolvedValueOnce(null);
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('Passkey creation cancelled or failed');
    });
  });

  // ── signIn — WebAuthn re-auth branch ──────────────────────────────────────

  describe('signIn without credentials + no ?requestId (WebAuthn re-auth)', () => {
    it('does not reconnect when the user is already authenticated (reauth for encryption key derivation only)', async () => {
      let userChangedHandler: ((payload: { user: unknown }) => void) | undefined;
      mockOn.mockImplementation((event: string, handler: (payload: { user: unknown }) => void) => {
        if (event === 'nexus.events.socketAPIUserChanged') userChangedHandler = handler;
      });

      const { result } = renderHook(() => useAuthentication());

      // Simulate the socket delivering an authenticated user (valid session cookie already present)
      await act(async () => { userChangedHandler?.({ user: { id: 'u1', name: 'Alice' } }); });

      // Now reauth is called by MXDBSyncInner to re-derive the encryption key
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ userId: 'u1' }) });
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());

      await act(async () => { await (result.current.signIn as any)(); });

      expect(mockCredentialsGet).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/reauth'),
        expect.objectContaining({ method: 'POST' }),
      );
      // Must NOT reconnect — socket is already authenticated; reconnect causes a visible
      // disconnect/reconnect flicker and resets the userId → triggers full re-auth loading screen
      expect(mockReconnect).not.toHaveBeenCalled();
    });

    it('does not reconnect when an HTTP session cookie already authenticates the user at mount time', async () => {
      // Simulates the case where the user's session cookie is valid before the hook even mounts.
      mockGetCurrentUser.mockReturnValueOnce({ id: 'u1', name: 'Alice' } as any);
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ userId: 'u1' }) });
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());

      await act(async () => { await (result.current.signIn as any)(); });

      expect(mockCredentialsGet).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/reauth'),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockReconnect).not.toHaveBeenCalled();
    });

    it('does not start a second WebAuthn ceremony if one is already in flight (deduplication)', async () => {
      let resolveReauth!: () => void;
      const reauthHeld = new Promise<void>(res => { resolveReauth = res; });

      mockFetch.mockImplementationOnce(() => reauthHeld.then(() => ({ ok: true, json: () => Promise.resolve({ userId: 'u1' }) })));
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());

      await act(async () => {
        const p1 = (result.current.signIn as any)() as Promise<void>;
        const p2 = (result.current.signIn as any)() as Promise<void>;
        resolveReauth();
        await p1;
        await p2;
      });

      expect(mockCredentialsGet).toHaveBeenCalledTimes(1);
    });

    it('calls navigator.credentials.get, posts to reauth endpoint, and reconnects', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ userId: 'u1' }) });
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());
      await act(async () => { await (result.current.signIn as any)(); });

      expect(mockCredentialsGet).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/reauth'),
        expect.objectContaining({ method: 'POST' }),
      );
      const reauthBody = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(typeof reauthBody.keyHash).toBe('string');
      expect(reauthBody.keyHash).toHaveLength(64);
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('throws when navigator.credentials.get returns null', async () => {
      mockCredentialsGet.mockResolvedValueOnce(null);
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('Passkey authentication cancelled or failed');
    });

    it('throws when the reauth endpoint returns a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow();
    });
  });
});
