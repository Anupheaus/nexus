export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  message: string;
}

/** Decides per request whether `origin` may call `path` — for policies a static list can't express
 *  (e.g. your own app origins everywhere, but any origin on a public embed endpoint). */
export type CorsOriginPredicate = (origin: string, path: string) => boolean;

export interface CorsConfig {
  allowedOrigins: string | string[] | RegExp | CorsOriginPredicate;
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
  /** Send `Access-Control-Allow-Credentials: true`, needed when the client calls with
   *  `credentials: 'include'` (the nexus REST client does) so cookies ride cross-origin requests. */
  allowCredentials: boolean;
}

/** Which requests may carry dotted keys (see {@link OperatorKeyGuardConfig}). */
export type DottedKeyAllowance = (request: { path: string; method: string }) => boolean;

/**
 * The operator-key guard ahead of every HTTP route: a `$`-prefixed key in the query string or body is always refused
 * (400). Dotted keys (which MongoDB reads as paths) are refused only when the app opts in with `refuseDottedKeys: true`
 * — off by default, so taking this version never breaks an app whose routes receive dotted names — and then on every
 * request `isDottedKeyAllowed` does not exempt, e.g. a webhook path whose provider sends dotted names (Meta's `hub.mode`,
 * an inbound email's header map).
 */
export interface OperatorKeyGuardConfig {
  refuseDottedKeys?: boolean;
  isDottedKeyAllowed?: DottedKeyAllowance;
}

export interface SecurityConfig {
  rateLimit?: Partial<RateLimitConfig> | false;
  /**
   * The operator-key guard; on by default. `false` turns it off (only for an app that checks every route itself).
   * App-wide only — `withSecurity` cannot change it for a route.
   */
  operatorKeys?: OperatorKeyGuardConfig | false;
  cors?: ({ allowedOrigins: CorsConfig['allowedOrigins'] } & Partial<Omit<CorsConfig, 'allowedOrigins'>>) | false;
  maxBodySizeKb?: number;
  trustedProxyHops?: number;
  securityHeaders?: boolean;
}

export interface ResolvedSecurityConfig {
  rateLimit: RateLimitConfig | false;
  operatorKeys: OperatorKeyGuardConfig | false;
  cors: CorsConfig | false;
  maxBodySizeKb: number;
  trustedProxyHops: number;
  securityHeaders: boolean;
}

const CORS_FIELD_DEFAULTS: Omit<CorsConfig, 'allowedOrigins'> = {
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAgeSeconds: 600,
  allowCredentials: false,
};

// rateLimit is enabled by default; cors defaults to false because no CORS headers = browser enforces same-origin policy.
export const SECURITY_DEFAULTS: {
  rateLimit: RateLimitConfig;
  operatorKeys: OperatorKeyGuardConfig;
  cors: false;
  maxBodySizeKb: number;
  trustedProxyHops: number;
  securityHeaders: boolean;
} = {
  rateLimit: {
    maxRequests: 100,
    windowMs: 60_000,
    message: 'Too many requests',
  },
  operatorKeys: {},
  cors: false,
  maxBodySizeKb: 512,
  trustedProxyHops: 1,
  securityHeaders: true,
};

export function resolveSecurityConfig(config?: SecurityConfig): ResolvedSecurityConfig {
  const rateLimit: RateLimitConfig | false = config?.rateLimit === false
    ? false
    : config?.rateLimit != null
      ? { ...SECURITY_DEFAULTS.rateLimit, ...config.rateLimit }
      : { ...SECURITY_DEFAULTS.rateLimit };

  const cors: CorsConfig | false = config?.cors === false
    ? false
    : config?.cors != null
      ? { ...CORS_FIELD_DEFAULTS, ...config.cors }
      : false;

  return {
    rateLimit,
    operatorKeys: config?.operatorKeys ?? { ...SECURITY_DEFAULTS.operatorKeys },
    cors,
    maxBodySizeKb: config?.maxBodySizeKb ?? SECURITY_DEFAULTS.maxBodySizeKb,
    trustedProxyHops: config?.trustedProxyHops ?? SECURITY_DEFAULTS.trustedProxyHops,
    securityHeaders: config?.securityHeaders ?? SECURITY_DEFAULTS.securityHeaders,
  };
}

/**
 * What a route may override with `withSecurity`. The operator-key guard is app-wide only: it runs ahead of every route,
 * before any route's own middleware, so a per-route setting could never reach it.
 */
export type RouteSecurityConfig = Omit<SecurityConfig, 'operatorKeys'>;

export function mergeSecurityConfig(base: ResolvedSecurityConfig, override: RouteSecurityConfig): ResolvedSecurityConfig {
  const rateLimit: RateLimitConfig | false = override.rateLimit === false
    ? false
    : override.rateLimit != null
      ? { ...(base.rateLimit !== false ? base.rateLimit : SECURITY_DEFAULTS.rateLimit), ...override.rateLimit }
      : base.rateLimit;

  const cors: CorsConfig | false = override.cors === false
    ? false
    : override.cors != null
      ? {
        ...CORS_FIELD_DEFAULTS,
        ...(base.cors !== false ? base.cors : {}),
        ...override.cors,
      }
      : base.cors;

  return {
    rateLimit,
    operatorKeys: base.operatorKeys,
    cors,
    maxBodySizeKb: override.maxBodySizeKb ?? base.maxBodySizeKb,
    trustedProxyHops: override.trustedProxyHops ?? base.trustedProxyHops,
    securityHeaders: override.securityHeaders ?? base.securityHeaders,
  };
}
