import type { Logger } from '@anupheaus/common';

/** PEM-encoded TLS material — the shape shared by `provided` SSL config and `updateCertificate`. */
export interface TLSCertificate {
  /** PEM-encoded certificate — the full chain (leaf + intermediates) where available. */
  cert: string;
  /** PEM-encoded private key. */
  key: string;
  /** PEM-encoded CA chain, when the intermediates are supplied separately from `cert`. Optional. */
  ca?: string;
}

/**
 * Self-signed (the default): `startServer` generates a local root CA + wildcard server certificate
 * under `certsPath`, installing the CA in the OS trust store on first run. A bare `{ host }` with no
 * `mode` resolves to this, so existing callers are unaffected.
 */
export interface SelfSignedSSLConfig {
  mode?: 'self-signed';
  /**
   * Hostname used for the generated certificate's Common Name and Subject Alt Name. Use a wildcard
   * (e.g. `'*.example.com'`) to cover all subdomains. @default 'localhost'
   */
  host?: string;
  /**
   * Directory where the root CA and server certificate files are stored. Created automatically on
   * first run; reused on subsequent starts. @default './certs'
   */
  certsPath?: string;
}

/**
 * Provided: use an externally-issued certificate (e.g. a Let's Encrypt wildcard) instead of
 * generating one. No CA is created or installed — the process trusts whatever chain the client
 * already trusts. The values are PEM **contents**, not file paths (read them from a secret/file and
 * pass them in), so this works identically for local dev and a deployed origin.
 */
export interface ProvidedSSLConfig extends TLSCertificate {
  mode: 'provided';
}

/**
 * Off: serve plain HTTP. For deployments where TLS is terminated by a proxy in front of the process
 * (e.g. Cloudflare or a load balancer) so the app itself does not need a certificate.
 */
export interface OffSSLConfig {
  mode: 'off';
}

/**
 * How `startServer` provisions TLS. A bare `{ host }` (no `mode`) is treated as `'self-signed'`.
 */
export type SSLConfig = SelfSignedSSLConfig | ProvidedSSLConfig | OffSSLConfig;

export interface CreateSSLServerOptions {
  ssl: SSLConfig;
  port: number;
  logger: Logger;
}
