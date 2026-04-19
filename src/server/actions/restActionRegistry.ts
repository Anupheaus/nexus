import type { SocketAPIAction } from '../../common';
import type { SocketAPIServerHandlerFunction } from '../handler/createServerHandler';
import type { ActionLimitGate } from '../handler/actionLimitGate';

export interface RestActionRegistryEntry {
  handler: SocketAPIServerHandlerFunction<unknown, unknown>;
  action: SocketAPIAction<string, unknown, unknown>;
  limitGate: ActionLimitGate;
}

const registry = new Map<string, RestActionRegistryEntry>();

export function registerRestAction<Request, Response>(
  action: SocketAPIAction<string, Request, Response>,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  limitGate: ActionLimitGate,
): void {
  registry.set(action.name, { handler, action, limitGate } as RestActionRegistryEntry);
}

export function getRestAction(name: string): RestActionRegistryEntry | undefined {
  return registry.get(name);
}

export function getAllRestActions(): RestActionRegistryEntry[] {
  return [...registry.values()];
}

export function clearRestActionRegistry(): void {
  registry.clear();
}
