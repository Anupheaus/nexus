import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import type { NexusActionServerOptions } from '../../common/defineAction';
import { AuthenticationError, InternalError, Logger, is, type PromiseMaybe } from '@anupheaus/common';
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

export function clearRegisteredHandlers(): void {
  registeredHandlers.clear();
}

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
      // Narrowed once here: the per-call function below cannot see the null check above.
      const socket = client;
      const limitGate = sharedLimitGate;
      client.on(
        fullName,
        wrap(client, (...args: unknown[]) => {
          // A random id, nothing derived from the caller: it names this call's log scope and every entry logged in it.
          const requestId = Math.uniqueId();
          return Logger.runInScope(() => handleCall(requestId, args), { id: requestId, meta: { requestId, clientId: client.id } });
        }),
      );

      async function handleCall(requestId: string, args: unknown[]): Promise<void> {
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
          // From here every entry of this call names its user too (ids only).
          if (user != null) Logger.setScopeMeta({ userId: user.id });
          await onBeforeHandle?.(socket);
          const { auth } = useConfig();
          if (auth != null && !isPublic && user == null) throw new AuthenticationError('Unauthorized');
          return (handler as Function)(...args, createSocketHandlerUtils(socket, requestId));
        }));
        const duration = performance.now() - startTime;
        const { error, response: ok } = getErrorFromAckResponse(result);
        if (error) {
          logger.error(`${name} ${pascalType} Error`, { error, requestId });
        } else {
          logger.debug(`${name} ${pascalType} Invoked`, { args, result: ok, requestId, duration: `${duration.toFixed(0)}ms` });
        }
        if (is.function(response)) response(result);
      }
    },
  };
}
