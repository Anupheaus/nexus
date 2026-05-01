import { useLogger } from '../async-context/socketApiContext';
import type { SocketAPIServerHandler } from './createServerHandler';

export function setupHandlers(handlers: SocketAPIServerHandler[]) {
  if (handlers.length === 0) return;
  const logger = useLogger();

  logger.debug('Setting up handlers...');
  handlers.forEach(handler => handler.registerSocket());
  logger.debug('Handlers set up.');
}
