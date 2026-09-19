import { createServer } from 'https';
import type { Server as HttpsServer } from 'https';
import { Duplex } from 'stream';
import type { Logger } from '@anupheaus/common';
import { Cert } from 'selfsigned-ca';
import type { CertOptions } from 'selfsigned-ca';
import type { AnyHttpServer } from '../internalModels';
import type { CreateSSLServerOptions, TLSCertificate } from './ssl-models';

/**
 * Builds a control that hot-swaps the running server's TLS certificate without a restart, via Node's
 * `setSecureContext`. New TLS handshakes use the new cert; existing connections are unaffected. No-ops
 * (with a warning) when the server is plain HTTP, so callers can invoke it unconditionally.
 */
export function makeUpdateCertificate(server: AnyHttpServer, logger: Logger): (cert: TLSCertificate) => void {
  return ({ cert, key, ca }) => {
    const maybeHttps = server as Partial<HttpsServer>;
    if (typeof maybeHttps.setSecureContext !== 'function') {
      logger.warn('updateCertificate ignored: the running server is not an HTTPS server.');
      return;
    }
    maybeHttps.setSecureContext({ cert, key, ca });
    logger.info('TLS certificate hot-reloaded via setSecureContext.');
  };
}

async function loadRootCertificate(rootCaCert: Cert, logger: Logger) {
  logger.info('Loading root certificate...');
  await rootCaCert.load();
  if (!await rootCaCert.isInstalled()) {
    logger.info('Installing root certificate...');
    await rootCaCert.install();
    logger.info('Root certificate installed.');
  } else {
    logger.info('Root certificate loaded.');
  }
}

async function createRootCertificate(rootCaCert: Cert, logger: Logger) {
  logger.info('Creating root certificate...');
  rootCaCert.createRootCa({
    subject: {
      commonName: 'Lintex Software',
      organizationName: 'Lintex Software',
      organizationalUnitName: 'Software Development',
      countryName: 'UK',
    },
  });
  logger.info('Root certificate created, saving...');
  await rootCaCert.save();
  logger.info('Root certificate saved, installing...');
  await rootCaCert.install();
  logger.info('Root certificate installed.');
}

async function createServerCertificate(serverCert: Cert, rootCaCert: Cert, logger: Logger, host: string) {
  const serverCertOptions: CertOptions = {
    subject: {
      commonName: host,
      organizationName: 'Lintex Software',
      organizationalUnitName: 'Software Development',
      countryName: 'UK',
    },
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: host }, // DNS
        { type: 7, ip: '127.0.0.1' }, // IP
      ],
    }],
  };
  logger.info('Creating server certificate...');
  serverCert.create(serverCertOptions, rootCaCert);
  logger.info('Server certificate created, saving...');
  await serverCert.save();
  logger.info('Server certificate saved.');
}

function createCertificate(serverCert: Cert, rootCaCert: Cert, logger: Logger, host: string) {
  return async () => {
    try {
      await loadRootCertificate(rootCaCert, logger);
    } catch {
      logger.error('Failed to load root certificate, creating a new certificate...');
      await createRootCertificate(rootCaCert, logger);
    }
    await createServerCertificate(serverCert, rootCaCert, logger, host);
  };
}

function startSSLServer(logger: Logger, serverCert: Cert) {
  return async () => {
    logger.info('Starting SSL server...');
    return createServer({
      key: serverCert.key,
      cert: serverCert.cert,
      ca: serverCert.caCert,
      rejectUnauthorized: false,
      requestCert: false,
    });
  };
}

function startNormalServer(logger: Logger) {
  return async () => {
    logger.info('Starting normal server...');
    const { createServer: createHttpServer } = await import('http');
    return createHttpServer();
  };
}

function normaliseCertsPath(certsPath: string): string {
  // Strip any combination of trailing forward slashes and backslashes
  return certsPath.replace(/[/\\]+$/, '');
}

/**
 * Builds a self-signed HTTPS server, generating (and installing) the root CA + server certificate the
 * first time and reusing the files under `certsPath` afterwards. Falls back to a plain HTTP server if
 * TLS setup fails, so the process still boots.
 */
async function createSelfSignedServer(host: string, certsPath: string, logger: Logger): Promise<AnyHttpServer> {
  certsPath = normaliseCertsPath(certsPath);
  logger.debug('SSL certificates path', { certsPath });

  const rootCaCert = new Cert(`${certsPath}/root-ca`);
  const serverCert = new Cert(`${certsPath}/server`);

  return await serverCert.load()
    .catch(createCertificate(serverCert, rootCaCert, logger, host))
    .then(startSSLServer(logger, serverCert))
    .catch(startNormalServer(logger)) as AnyHttpServer;
}

export async function createSSLServer({ ssl, port, logger }: CreateSSLServerOptions): Promise<{
  server: AnyHttpServer;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  updateCertificate(cert: TLSCertificate): void;
}> {
  let server: AnyHttpServer;

  if (ssl.mode === 'off') {
    server = await startNormalServer(logger)() as AnyHttpServer;
  } else if (ssl.mode === 'provided') {
    // Use an externally-issued certificate (PEM contents) — no CA generation. A bad cert/key throws
    // here rather than silently downgrading, so a misconfiguration is visible at startup.
    logger.info('Starting SSL server with a provided certificate...');
    server = createServer({
      key: ssl.key,
      cert: ssl.cert,
      ca: ssl.ca,
      rejectUnauthorized: false,
      requestCert: false,
    }) as AnyHttpServer;
  } else {
    server = await createSelfSignedServer(ssl.host ?? 'localhost', ssl.certsPath ?? './certs', logger);
  }

  const allConnections = new Set<Duplex>();
  server.on('connection', connection => {
    allConnections.add(connection);
    connection.on('close', () => allConnections.delete(connection));
  });

  const startListening = () => new Promise<void>(resolve => {
    logger.info(`Listening on port ${port}...`);
    server.listen(port, resolve);
  });

  const stopListening = () => new Promise<void>((resolve, reject) => {
    allConnections.forEach(connection => connection.destroy());
    server.close(error => {
      if (error != null) { reject(error); return; }
      resolve();
    });
  });

  return { server, startListening, stopListening, updateCertificate: makeUpdateCertificate(server, logger) };
}
