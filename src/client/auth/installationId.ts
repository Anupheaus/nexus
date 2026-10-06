/** Where an installation keeps its id: one per origin, so one per browser profile or installed app (sc-645). */
export const INSTALLATION_ID_STORAGE_KEY = 'nexus:installation-id';

/** Used when storage is unavailable (private mode, blocked site data): one id for as long as this page is open. */
let pageInstallationId: string | undefined;

/**
 * This app installation's id (sc-645): a random id created the first time it is needed and kept for as long as the app
 * stays installed (or the browser keeps this site's data). The server tells devices that share a synced passkey apart by
 * it, so each installation is its own device.
 */
export function getInstallationId(): string {
  try {
    const stored = localStorage.getItem(INSTALLATION_ID_STORAGE_KEY);
    if (stored != null && stored.length > 0) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, created);
    return created;
  } catch {
    // Storage is unavailable or refused: an id for this page only. The installation then signs in as a new device each
    // time it is opened, which costs a licence seat but never lets two installations share a session.
    pageInstallationId ??= crypto.randomUUID();
    return pageInstallationId;
  }
}
