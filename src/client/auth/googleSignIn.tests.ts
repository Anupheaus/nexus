import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performGoogleSignIn } from './googleSignIn';
// @capacitor/* are optional peer deps aliased to stubs in vitest.config.ts.
// Importing here gives us direct access to the vi.fn() instances for assertions.
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

// ---------------------------------------------------------------------------
// GIS SDK mock factory
// ---------------------------------------------------------------------------

interface GisMockOptions {
  oneTapResult: 'success' | 'suppressed';
  oneTapCredential?: string;
}

function makeGoogleMock({ oneTapResult, oneTapCredential = 'id-tok' }: GisMockOptions) {
  return {
    accounts: {
      id: {
        initialize: vi.fn(({ callback }: { callback: (cred: { credential: string }) => void }) => {
          if (oneTapResult === 'success') setTimeout(() => callback({ credential: oneTapCredential }), 0);
        }),
        prompt: vi.fn((notify?: (n: { isNotDisplayed(): boolean }) => void) => {
          if (oneTapResult === 'suppressed' && notify) notify({ isNotDisplayed: () => true });
        }),
        cancel: vi.fn(),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Window helpers
//
// jsdom's window.open, window.location, and window.sessionStorage are tricky
// to stub via vi.spyOn because of how jsdom binds them internally. We instead
// replace the property descriptors directly and restore them in afterEach.
// ---------------------------------------------------------------------------

let openMock: ReturnType<typeof vi.fn>;
const originalOpen = window.open.bind(window);

function installOpenMock(returnValue: Window | null = null) {
  openMock = vi.fn(() => returnValue);
  Object.defineProperty(window, 'open', { value: openMock, writable: true, configurable: true });
}

function restoreOpen() {
  Object.defineProperty(window, 'open', { value: originalOpen, writable: true, configurable: true });
}

// We track window.location.href changes by replacing the location object.
// jsdom does not allow setting window.location.href to an arbitrary string
// (it triggers real navigation), so we use a plain object stand-in.
let locationStub: { href: string; origin: string };

function installLocationStub() {
  locationStub = { href: 'http://localhost/', origin: 'http://localhost' };
  Object.defineProperty(window, 'location', { value: locationStub, writable: true, configurable: true });
}

function restoreLocation() {
  // We cannot restore the real Location object cleanly, but jsdom recreates
  // it per test suite run so no cleanup is needed — subsequent tests that do
  // not call installLocationStub will use the real location.
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('performGoogleSignIn', () => {
  const originalCapacitor = (window as Record<string, unknown>).Capacitor;

  beforeEach(() => {
    vi.clearAllMocks();
    delete (global as Record<string, unknown>).google;
    (window as Record<string, unknown>).Capacitor = undefined;
  });

  afterEach(() => {
    restoreOpen();
    restoreLocation();
    (window as Record<string, unknown>).Capacitor = originalCapacitor;
  });

  // ---------------------------------------------------------------------------
  // One Tap success
  // ---------------------------------------------------------------------------

  it('calls onOneTap with the credential when One Tap succeeds', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'success' });
    installOpenMock();

    const onOneTap = vi.fn(async () => { /* noop */ });
    const onComplete = vi.fn();

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap, onComplete });

    expect(onOneTap).toHaveBeenCalledWith('id-tok');
  });

  it('calls onComplete after One Tap succeeds', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'success' });
    installOpenMock();

    const onOneTap = vi.fn(async () => { /* noop */ });
    const onComplete = vi.fn();

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap, onComplete });

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('does not open a popup when One Tap succeeds', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'success' });
    installOpenMock();

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn() });

    expect(openMock).not.toHaveBeenCalled();
  });

  it('passes the exact credential string from the GIS callback to onOneTap', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'success', oneTapCredential: 'specific-jwt-token' });
    installOpenMock();

    const onOneTap = vi.fn(async () => { /* noop */ });

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap, onComplete: vi.fn() });

    expect(onOneTap).toHaveBeenCalledWith('specific-jwt-token');
  });

  // ---------------------------------------------------------------------------
  // One Tap suppressed → falls through to popup
  // ---------------------------------------------------------------------------

  it('opens a popup when One Tap is suppressed', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'suppressed' });
    // Return a non-null popup so tryPopup enters the message-wait branch
    installOpenMock({ closed: false } as unknown as Window);

    // Do not await — the popup flow waits for a message event that never fires in this test
    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn() });

    // tryOneTap resolves via a Promise microtask, so yield before asserting
    await Promise.resolve();

    expect(openMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/google/start'),
      '_blank',
      expect.any(String),
    );
    expect(openMock).toHaveBeenCalledWith(
      expect.stringContaining('popup=true'),
      '_blank',
      expect.any(String),
    );

    promise.catch(() => { /* expected — popup message will never fire in jsdom */ });
  });

  it('includes postAuthUrl in the popup URL', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'suppressed' });
    installOpenMock({ closed: false } as unknown as Window);

    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn() });

    await Promise.resolve();

    expect(openMock).toHaveBeenCalledWith(
      expect.stringContaining('postAuthUrl='),
      '_blank',
      expect.any(String),
    );

    promise.catch(() => { /* expected */ });
  });

  it('calls onComplete when the popup sends the google-oauth-complete message', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'suppressed' });
    installOpenMock({ closed: false } as unknown as Window);

    const onComplete = vi.fn();
    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete });

    // Dispatch a real MessageEvent so the handler registered by tryPopup fires
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'google-oauth-complete' },
    }));

    await promise;

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('ignores message events from other origins', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'suppressed' });
    installOpenMock({ closed: false } as unknown as Window);

    const onComplete = vi.fn();
    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete });

    // Message from a different origin — must be ignored
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://attacker.com',
      data: { type: 'google-oauth-complete' },
    }));

    expect(onComplete).not.toHaveBeenCalled();

    // Resolve the promise by sending a legitimate message, then assert it resolves cleanly
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'google-oauth-complete' },
    }));
    await promise;
  });

  // ---------------------------------------------------------------------------
  // Popup blocked → redirect fallback
  // ---------------------------------------------------------------------------

  it('redirects when the popup is blocked (window.open returns null)', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'suppressed' });
    installOpenMock(null);
    installLocationStub();

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn() });

    expect(locationStub.href).toContain('/auth/google/start');
  });

  it('includes redirectMode=true in the redirect URL', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'suppressed' });
    installOpenMock(null);
    installLocationStub();

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn() });

    expect(locationStub.href).toContain('redirectMode=true');
  });

  it('saves the return URL to sessionStorage before redirecting', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'suppressed' });
    installOpenMock(null);
    installLocationStub();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn() });

    expect(setItemSpy).toHaveBeenCalledWith('google-oauth-return-url', expect.any(String));
    setItemSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // skipOneTap
  // ---------------------------------------------------------------------------

  it('skips One Tap and opens popup directly when skipOneTap is true', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'success' });
    installOpenMock({ closed: false } as unknown as Window);

    const onOneTap = vi.fn(async () => { /* noop */ });
    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap, onComplete: vi.fn(), skipOneTap: true });

    // No One Tap path to await — window.open is called on the first tick after the check
    await Promise.resolve();

    // One Tap was skipped so window.open must have been called without onOneTap firing
    expect(openMock).toHaveBeenCalledOnce();
    expect(onOneTap).not.toHaveBeenCalled();

    promise.catch(() => { /* expected — popup listener won't fire */ });
  });

  it('falls through to redirect when skipOneTap=true and popup is blocked', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock({ oneTapResult: 'success' });
    installOpenMock(null);
    installLocationStub();

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn(), skipOneTap: true });

    expect(locationStub.href).toContain('/auth/google/start');
  });

  // ---------------------------------------------------------------------------
  // GIS SDK load failure
  // ---------------------------------------------------------------------------

  it('falls through to popup when the GIS SDK fails to load', async () => {
    // No global.google — force the script's onerror so loadGisSdk rejects
    const scriptStub = { src: '', async: false, onload: null as (() => void) | null, onerror: null as (() => void) | null };
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementationOnce(() => {
      setTimeout(() => scriptStub.onerror?.(), 0);
      return scriptStub as unknown as HTMLElement;
    });
    const appendChildSpy = vi.spyOn(document.head, 'appendChild').mockImplementationOnce(() => document.head);

    // SDK fails → tryOneTap returns false → tryPopup called → popup blocked → redirect
    installOpenMock(null);
    installLocationStub();

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn() });

    // window.open was called (returned null → fell through to redirect)
    expect(openMock).toHaveBeenCalledOnce();

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Capacitor path
  // ---------------------------------------------------------------------------

  async function resolveCapacitorFlow(): Promise<void> {
    // tryCapacitor awaits two dynamic imports before registering the appUrlOpen listener.
    // Flushing all pending microtasks and one macro-task tick is enough to reach it.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const addListenerMock = vi.mocked(App.addListener);
    const listenerCall = addListenerMock.mock.calls.find(([event]) => event === 'appUrlOpen');
    if (!listenerCall) return;
    const handler = listenerCall[1] as () => Promise<void>;
    await handler();
  }

  it('opens the Capacitor browser when window.Capacitor is present', async () => {
    (window as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
    installOpenMock();

    const onComplete = vi.fn();
    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete });

    await resolveCapacitorFlow();
    await promise;

    expect(Browser.open).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/auth/google/start') }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('includes platform=capacitor in the Capacitor browser URL', async () => {
    (window as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
    installOpenMock();

    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap: vi.fn(async () => { /* noop */ }), onComplete: vi.fn() });

    await resolveCapacitorFlow();
    await promise;

    expect(Browser.open).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('platform=capacitor') }));
  });

  it('does not try One Tap or popup when Capacitor is present', async () => {
    (window as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
    installOpenMock();

    const onOneTap = vi.fn(async () => { /* noop */ });
    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/auth/google/start', onOneTap, onComplete: vi.fn() });

    await resolveCapacitorFlow();
    await promise;

    expect(onOneTap).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });
});
