import { afterEach, describe, it, expect, vi } from 'vitest';
import { INSTALLATION_ID_STORAGE_KEY, getInstallationId } from './installationId';

// sc-645: an installation keeps one id, so a synced passkey's installations are told apart.

describe('getInstallationId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('creates an id once and keeps it', () => {
    const first = getInstallationId();
    expect({ second: getInstallationId(), stored: localStorage.getItem(INSTALLATION_ID_STORAGE_KEY) }).toEqual({ second: first, stored: first });
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the id an earlier visit stored', () => {
    localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, 'kept-id');
    expect(getInstallationId()).toBe('kept-id');
  });

  it('keeps one id for the page when storage refuses it', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const first = getInstallationId();
    expect(getInstallationId()).toBe(first);
  });
});
