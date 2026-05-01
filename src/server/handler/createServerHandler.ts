import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import type { SocketAPIActionServerOptions } from '../../common/defineAction';
import { InternalError, is, type PromiseMaybe } from '@anupheaus/common';
import { useSocketAPI } from '../providers';
import { useConfig, wrap, useLogger } from '../async-context/socketApiContext';
import { createActionLimitGate, type ActionLimitGate } from './actionLimitGate';
import { useAuthentication } from '../providers/authentication';
import { createSocketHandlerUtils } from './handlerUtils';
import type { SocketAPIServerHandlerActionUtils } from './handlerUtils';

export interface SocketAPIServerHandler {
  registerSocket(): void;
}

export type SocketAPIServerHandlerFunction<Request, Response> = (
  request: Request,
  utils: SocketAPIServerHandlerActionUtils,
) => PromiseMaybe<Response>;

const registeredHandlers = new Set<string>();

export function createServerHandler<Request, Response>(
  type: string,
  prefix: string,
  name: string,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  serverLimits?: SocketAPIActionServerOptions,
  isPublic = false,
  existingLimitGate?: ActionLimitGate,
  transport?: Array<'socket' | 'rest'>,
): SocketAPIServerHandler {
  const fullName = `${prefix}.${name}`;
  const pascalType = type.toPascalCase();
  if (registeredHandlers.has(fullName)) throw new InternalError(`Handler for ${type} '${fullName}' already registered.`);
  registeredHandlers.add(fullName);
  const sharedLimitGate: ActionLimitGate = existingLimitGate ?? createActionLimitGate(serverLimits);
  return {
    registerSocket: () => {
      const logger = useLogger();
      const { getClient } = useSocketAPI();
      const client = getClient(true);
      const limitGate = sharedLimitGate;
      logger.silly(`Registering ${type} '${fullName}'...`);
      client.on(
        fullName,
        wrap(client, async (...args: unknown[]) => {
          const requestId = Math.uniqueId();
          const response = args.pop();

          // Transport check — reject socket calls to REST-only actions before any auth or limit gate.
          if (transport != null && !transport.includes('socket')) {
            if (is.function(response)) response({ error: { message: 'This action is only available via REST' } });
            return;
          }

          const startTime = performance.now();
          const result = await wrapAckHandler(() => limitGate.run(async () => {
            const { onBeforeHandle } = useConfig();
            const { user } = useAuthentication();
            await onBeforeHandle?.(client);
            const { auth } = useConfig();
            if (auth != null && !isPublic && user == null) throw new Error('Unauthorized');
            return (handler as Function)(...args, createSocketHandlerUtils(client, requestId));
          }));
          const duration = performance.now() - startTime;
          const { error, response: ok } = getErrorFromAckResponse(result);
          if (error) {
            logger.error(`${name} ${pascalType} Error`, { error, requestId });
          } else {
            logger.debug(`${name} ${pascalType} Invoked`, { args, result: ok, requestId, duration: `${duration.toFixed(0)}ms` });
          }
          if (is.function(response)) response(result);
        }),
      );
    },
  };
}
