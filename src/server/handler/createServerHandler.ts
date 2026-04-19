import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import type { SocketAPIActionServerOptions } from '../../common/defineAction';
import { InternalError, is, type PromiseMaybe } from '@anupheaus/common';
import { useSocketAPI } from '../providers';
import { useConfig, wrap, useLogger, useAuthData } from '../async-context/socketApiContext';
import { createActionLimitGate, type ActionLimitGate } from './actionLimitGate';

export type SocketAPIServerHandler = () => void;

export type SocketAPIServerHandlerFunction<Request, Response> = (request: Request) => PromiseMaybe<Response>;

const registeredHandlers = new Set<string>();

export function createServerHandler<Request, Response>(
  type: string,
  prefix: string,
  name: string,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  serverLimits?: SocketAPIActionServerOptions,
  isPublic = false,
): SocketAPIServerHandler {
  const fullName = `${prefix}.${name}`;
  const pascalType = type.toPascalCase();
  if (registeredHandlers.has(fullName)) throw new InternalError(`Handler for ${type} '${fullName}' already registered.`);
  registeredHandlers.add(fullName);
  let sharedLimitGate: ActionLimitGate | undefined;
  return () => {
    const logger = useLogger();
    const { getClient } = useSocketAPI();
    const client = getClient(true);
    sharedLimitGate ??= createActionLimitGate(serverLimits);
    const limitGate = sharedLimitGate;
    logger.silly(`Registering ${type} '${fullName}'...`);
    client.on(
      fullName,
      wrap(client, async (...args: unknown[]) => {
        const requestId = Math.uniqueId();
        const response = args.pop();
        const startTime = performance.now();
        const result = await wrapAckHandler(() => limitGate.run(async () => {
          const { onBeforeHandle } = useConfig();
          await onBeforeHandle?.(client);
          const { auth } = useConfig();
          if (auth != null && !isPublic && useAuthData()?.user == null) throw new Error('Unauthorized');
          return (handler as Function)(...args);
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
  };
}
