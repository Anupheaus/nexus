
import { config } from 'dotenv';
config();
import { Logger } from '@anupheaus/common';
import { startServer } from '../../../src/server';
import http from 'http';
import { configureViews } from './configureViews';
import { configureStaticFiles } from './configureStaticFiles';
import { actions } from './configureActions';
const port = 3010;

const logger = new Logger('mxdb-sync');

async function start() {
  const server = http.createServer();
  const { app } = await startServer({
    name: 'test',
    logger,
    actions,
    server,
  });
  configureStaticFiles(app);
  configureViews(app);
  logger.info(`Server listening on port ${port}...`);
  server.listen(port);
}

start();