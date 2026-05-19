import type { Logger } from '@anupheaus/common';

export interface SSLConfig {
  /** Hostname for the SSL certificate. Defaults to `'localhost'`. */
  host?: string;
  /** Directory path for SSL certificate files. Defaults to `'./certs'`. */
  certsPath?: string;
  logger?: Logger;
}
