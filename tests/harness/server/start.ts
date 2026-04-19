
import { config } from 'dotenv';
config();
import { Logger } from '@anupheaus/common';
import { startServer } from '../../../src/server';
import http from 'http';
import { configureViews } from './configureViews';
import { configureStaticFiles } from './configureStaticFiles';
import { actions } from './configureActions';
import { testPrivateKey } from './private-key';

const port = 3010;

const logger = new Logger('mxdb-sync');

async function start() {
  const server = http.createServer();
  const { app } = await startServer({
    name: 'test',
    logger,
    actions,
    server,
    privateKey: testPrivateKey,
    // onSavePrivateKey: async (_client, user, privateKey) => {
    //   privateKeys.set(user.id, privateKey);
    // },
    // onLoadPrivateKey: async (_client, user) => privateKeys.get(user.id),
  });
  configureStaticFiles(app);
  configureViews(app);
  logger.info(`Server listening on port ${port}...`);
  server.listen(port);
}

start();