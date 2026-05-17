export interface GoogleSignInOptions {
  clientId: string;
  startUrl: string;
  onOneTap(credential: string): Promise<void>;
  onComplete(): void;
  /** When true, skips One Tap and goes straight to popup → redirect. Used for incremental scope requests. */
  skipOneTap?: boolean;
}

declare const google: {
  accounts: {
    id: {
      initialize(opts: { client_id: string; callback(cred: { credential: string }): void }): void;
      prompt(notify?: (n: { isNotDisplayed(): boolean }) => void): void;
      cancel(): void;
    };
  };
} | undefined;

function loadGisSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load GIS SDK'));
    document.head.appendChild(script);
  });
}

function initOneTapCeremony(clientId: string, onOneTap: (cred: string) => Promise<void>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    google!.accounts.id.initialize({
      client_id: clientId,
      callback: async ({ credential }) => {
        try {
          await onOneTap(credential);
          resolve(true);
        } catch {
          resolve(false);
        }
      },
    });
    google!.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) resolve(false);
    });
  });
}

// Plain (non-async) function so callers get a synchronously-resolved Promise when
// google is already loaded — avoids an extra microtask tick on every sign-in call.
function tryOneTap(clientId: string, onOneTap: (cred: string) => Promise<void>): Promise<boolean> {
  if (typeof google !== 'undefined') return initOneTapCeremony(clientId, onOneTap);
  return loadGisSdk()
    .then(() => typeof google !== 'undefined' ? initOneTapCeremony(clientId, onOneTap) : false)
    .catch(() => false);
}

async function tryCapacitor(startUrl: string, onComplete: () => void): Promise<void> {
  const [{ Browser }, { App }] = await Promise.all([
    import('@capacitor/browser'),
    import('@capacitor/app'),
  ]);

  const url = `${startUrl}?platform=capacitor&postAuthUrl=capacitor`;
  await Browser.open({ url });

  await new Promise<void>((resolve) => {
    App.addListener('appUrlOpen', async () => {
      await Browser.close();
      onComplete();
      resolve();
    });
  });
}

export async function performGoogleSignIn({ clientId, startUrl, onOneTap, onComplete, skipOneTap = false }: GoogleSignInOptions): Promise<void> {
  // Capacitor: skip One Tap and popup entirely
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).Capacitor != null) {
    await tryCapacitor(startUrl, onComplete);
    return;
  }

  // Capture sessionStorage synchronously before any async operations.
  // After installLocationStub() replaces window.location in tests, jsdom's
  // sessionStorage getter may return a different object in async callbacks.
  const storage = window.sessionStorage ?? null;

  // Register the popup completion listener synchronously (before any await) so messages
  // dispatched while One Tap is still running are not missed.
  let resolvePopup!: (success: boolean) => void;
  const popupMessagePromise = new Promise<boolean>(resolve => { resolvePopup = resolve; });
  const onPopupMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if ((event.data as Record<string, unknown>)?.type === 'google-oauth-complete') {
      window.removeEventListener('message', onPopupMessage);
      resolvePopup(true);
    }
  };
  window.addEventListener('message', onPopupMessage);

  try {
    // 1. One Tap (skipped for incremental scope requests)
    if (!skipOneTap) {
      const oneTapSucceeded = await tryOneTap(clientId, onOneTap);
      if (oneTapSucceeded) { onComplete(); return; }
    }

    // 2. Popup
    const popup = window.open(
      `${startUrl}?popup=true&postAuthUrl=${encodeURIComponent(window.location.href)}`,
      '_blank',
      'width=500,height=600,toolbar=0,menubar=0',
    );

    if (popup) {
      await popupMessagePromise;
      onComplete();
      return;
    }

    // 3. Redirect fallback — save return URL before navigating away
    const currentUrl = window.location.href;
    storage?.setItem('google-oauth-return-url', currentUrl);
    window.location.href = `${startUrl}?redirectMode=true&postAuthUrl=${encodeURIComponent(currentUrl)}`;
  } finally {
    window.removeEventListener('message', onPopupMessage);
  }
}
