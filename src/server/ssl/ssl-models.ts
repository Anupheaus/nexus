import type { Logger } from '@anupheaus/common';

export interface CreateSSLServerOptions {
  host: string;
  port: number;
  certsPath: string;
  logger: Logger;
}

export interface SSLConfig {
  /**
   * Hostname used when generating the self-signed certificate's Common Name and Subject Alt Name.
   * Use a wildcard (e.g. `'*.example.com'`) to cover all subdomains.
   * @default 'localhost'
   */
  host?: string;
  /**
   * Directory where the root CA and server certificate files are stored.
   * Created automatically on first run; reused on subsequent starts.
   * @default './certs'
   */
  certsPath?: string;
}
