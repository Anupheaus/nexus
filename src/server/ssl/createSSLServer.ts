import { createServer } from 'https';
import { Duplex } from 'stream';
import type { Logger } from '@anupheaus/common';
import { Cert } from 'selfsigned-ca';
import type { CertOptions } from 'selfsigned-ca';
import type { AnyHttpServer } from '../internalModels';
import type { SSLConfig } from './ssl-models';

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

export async function createSSLServer({ host, port, certsPath, logger }: Required<SSLConfig>): Promise<{
  server: AnyHttpServer;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
}> {
  certsPath = normaliseCertsPath(certsPath);
  logger.debug('SSL certificates path', { certsPath });

  const rootCaCert = new Cert(`${certsPath}/root-ca`);
  const serverCert = new Cert(`${certsPath}/server`);

  const server = await serverCert.load()
    .catch(createCertificate(serverCert, rootCaCert, logger, host))
    .then(startSSLServer(logger, serverCert))
    .catch(startNormalServer(logger)) as AnyHttpServer;

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

  return { server, startListening, stopListening };
}
