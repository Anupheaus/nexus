import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import type { NexusActionServerOptions } from '../../common/defineAction';
import { InternalError, is, type PromiseMaybe } from '@anupheaus/common';
import { useClient } from '../providers';
import { useConfig, wrap, useLogger } from '../async-context/nexusContext';
import { createActionLimitGate, type ActionLimitGate } from './actionLimitGate';
import { useAuthentication } from '../providers/authentication';
import { createSocketHandlerUtils } from './handlerUtils';
import type { NexusServerHandlerActionUtils } from './handlerUtils';

export interface NexusServerHandler {
  registerSocket(): void;
}

export type NexusServerHandlerFunction<Request, Response> = (
  request: Request,
  utils: NexusServerHandlerActionUtils,
) => PromiseMaybe<Response>;

const registeredHandlers = new Set<string>();

export function createServerHandler<Request, Response>(
  type: string,
  prefix: string,
  name: string,
  handler: NexusServerHandlerFunction<Request, Response>,
  serverLimits?: NexusActionServerOptions,
  isPublic = false,
  existingLimitGate?: ActionLimitGate,
  transport?: Array<'socket' | 'rest'>,
): NexusServerHandler {
  const fullName = `${prefix}.${name}`;
  const pascalType = type.toPascalCase();
  if (registeredHandlers.has(fullName)) throw new InternalError(`Handler for ${type} '${fullName}' already registered.`);
  registeredHandlers.add(fullName);
  const sharedLimitGate: ActionLimitGate = existingLimitGate ?? createActionLimitGate(serverLimits);
  return {
    registerSocket: () => {
      const logger = useLogger();
      const client = useClient();
      if (client == null) throw new InternalError('Socket client is not available during handler registration');
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
