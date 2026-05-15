export type { AuthConfig, JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';
export type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';
export { setAuthConfig, getAuthConfig, clearAuthConfig } from './authConfig';
export { validateSessionCookie } from './validateSessionCookie';
export { registerAuthRoutes } from './registerAuthRoutes';
export { validateRestSession } from './validateRestSession';
