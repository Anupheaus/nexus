import { describe, it } from 'vitest';

// JWT token re-authentication tests removed — the socketAPIAuthenticateTokenAction
// is no longer auto-registered by startServer. JWT token auth is superseded by
// the new session-cookie-based auth system.

describe('internalActions', () => {
  it('legacy JWT token auth is deprecated', () => {
    // generateInternalActions() is still exported but no longer called by startServer.
    // The new auth system uses session cookies — see src/server/auth/.
  });
});
