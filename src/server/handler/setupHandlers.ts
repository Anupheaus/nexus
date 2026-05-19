import { useLogger } from '../async-context/nexusContext';
import type { NexusServerHandler } from './createServerHandler';

export function setupHandlers(handlers: NexusServerHandler[]) {
  if (handlers.length === 0) return;
  const logger = useLogger();

  logger.debug('Setting up handlers...');
  handlers.forEach(handler => handler.registerSocket());
  logger.debug('Handlers set up.');
}
