export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  message: string;
}

export interface CorsConfig {
  allowedOrigins: string | string[] | RegExp;
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
}

export interface SecurityConfig {
  rateLimit?: Partial<RateLimitConfig> | false;
  cors?: ({ allowedOrigins: CorsConfig['allowedOrigins'] } & Partial<Omit<CorsConfig, 'allowedOrigins'>>) | false;
  maxBodySizeKb?: number;
  trustedProxyHops?: number;
  securityHeaders?: boolean;
}

export interface ResolvedSecurityConfig {
  rateLimit: RateLimitConfig | false;
  cors: CorsConfig | false;
  maxBodySizeKb: number;
  trustedProxyHops: number;
  securityHeaders: boolean;
}

const CORS_FIELD_DEFAULTS: Omit<CorsConfig, 'allowedOrigins'> = {
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAgeSeconds: 600,
};

// rateLimit is enabled by default; cors defaults to false because no CORS headers = browser enforces same-origin policy.
export const SECURITY_DEFAULTS: {
  rateLimit: RateLimitConfig;
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
    cors,
    maxBodySizeKb: config?.maxBodySizeKb ?? SECURITY_DEFAULTS.maxBodySizeKb,
    trustedProxyHops: config?.trustedProxyHops ?? SECURITY_DEFAULTS.trustedProxyHops,
    securityHeaders: config?.securityHeaders ?? SECURITY_DEFAULTS.securityHeaders,
  };
}

export function mergeSecurityConfig(base: ResolvedSecurityConfig, override: SecurityConfig): ResolvedSecurityConfig {
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
    cors,
    maxBodySizeKb: override.maxBodySizeKb ?? base.maxBodySizeKb,
    trustedProxyHops: override.trustedProxyHops ?? base.trustedProxyHops,
    securityHeaders: override.securityHeaders ?? base.securityHeaders,
  };
}
