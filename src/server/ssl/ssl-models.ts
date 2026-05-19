import type { Logger } from '@anupheaus/common';

export interface SSLConfig {
  /** Hostname for the SSL certificate. Defaults to `'localhost'`. */
  host?: string;
  /** Port to listen on. Defaults to `3000`. */
  port?: number;
  /** Directory path for SSL certificate files. Defaults to `'./certs'`. */
  certsPath?: string;
  logger?: Logger;
}
