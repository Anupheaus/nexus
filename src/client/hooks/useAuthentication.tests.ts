import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthentication } from './useAuthentication';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockOn, mockOff, mockReconnect, mockConnect, mockDisconnect } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockReconnect: vi.fn(),
  mockConnect: vi.fn(() => Promise.resolve()),
  mockDisconnect: vi.fn(() => Promise.resolve()),
}));

vi.mock('../providers/socket/SocketContext', () => ({
  SocketContext: {
    _currentValue: {
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
    },
  },
}));

vi.mock('../auth/collectDeviceDetails', () => ({
  collectDeviceDetails: vi.fn(() => ({
    userAgent: 'test', platform: 'test', language: 'en',
    hardwareConcurrency: 4, maxTouchPoints: 0, vendor: 'test',
    screenWidth: 1920, screenHeight: 1080, viewportWidth: 1920,
    viewportHeight: 1080, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
  })),
}));

vi.mock('../auth/computeDeviceId', () => ({
  computeDeviceId: vi.fn(() => Promise.resolve('device-test-123')),
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

describe('client useAuthentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocationSearch('');
  });

  // ── original tests (keep verbatim) ────────────────────────────────────────

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
      expect.stringContaining('useAuthentication'),
      'socket-api.events.socketAPIUserChanged',
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

  // ── signOut ───────────────────────────────────────────────────────────────

  it('signOut calls the signout endpoint and reconnects', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useAuthentication());
    await act(async () => { await result.current.signOut(); });
    expect(mockFetch).toHaveBeenCalledWith(
      '/test/socketAPI/signout',
      { method: 'POST', credentials: 'include' },
    );
    expect(mockReconnect).toHaveBeenCalled();
  });

  // ── unmount cleanup ───────────────────────────────────────────────────────

  it('deregisters the event listener on unmount', () => {
    const { unmount } = renderHook(() => useAuthentication());
    unmount();
    expect(mockOff).toHaveBeenCalledWith(
      expect.stringContaining('useAuthentication'),
      'socket-api.events.socketAPIUserChanged',
    );
  });

  // ── signIn — JWT branch ───────────────────────────────────────────────────

  describe('signIn with credentials (JWT)', () => {
    it('posts to the signin endpoint with credentials and device info, then reconnects', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { result } = renderHook(() => useAuthentication<any, { email: string }>());
      await act(async () => { await result.current.signIn({ email: 'a@b.com' }); });
      expect(mockFetch).toHaveBeenCalledWith(
        '/test/socketAPI/signin',
        expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
      );
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.email).toBe('a@b.com');
      expect(body.deviceId).toBe('device-test-123');
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('throws when the signin endpoint returns a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const { result } = renderHook(() => useAuthentication<any, { email: string }>());
      await expect(
        act(async () => { await result.current.signIn({ email: 'bad@b.com' }); }),
      ).rejects.toThrow('Sign in failed: 401');
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
          json: () => Promise.resolve({ registrationToken: 'reg-token-abc', userDetails: { name: 'alice' } }),
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
      const registerBody = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
      expect(registerBody.registrationToken).toBe('reg-token-abc');
      expect(typeof registerBody.keyHash).toBe('string');
      expect(registerBody.keyHash).toHaveLength(64);
      expect(window.history.replaceState).toHaveBeenCalled();
      const replacedUrl = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(replacedUrl).not.toContain('requestId');
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('throws when the invite fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('Invite fetch failed: 404');
    });

    it('throws when navigator.credentials.create returns null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ registrationToken: 'tok', userDetails: { name: 'alice' } }),
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
      const reauthBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
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
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('WebAuthn re-authentication failed: 401');
    });
  });
});
