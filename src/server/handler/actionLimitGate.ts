import { InternalError, type PromiseMaybe } from '@anupheaus/common';
import type { NexusActionServerOptions } from '../../common/defineAction';

export interface ActionLimitGate {
  /** Waits for a slot, runs `delegate`, then releases the slot (even if `delegate` throws). */
  run<T>(delegate: () => PromiseMaybe<T>): Promise<T>;
}

/** Per-action gate: limits concurrent handler runs and optional bounded / timed wait queue. With no effective options, `run` just invokes the delegate. */
export function createActionLimitGate(limits?: NexusActionServerOptions): ActionLimitGate {
  if (!shouldUseLimitGate(limits)) {
    return {
      async run<T>(delegate: () => PromiseMaybe<T>): Promise<T> {
        return await delegate();
      },
    };
  }

  const maxConcurrent =
    limits.concurrent?.max ?? (limits.queue != null ? 1 : Number.POSITIVE_INFINITY);
  const maxQueue = limits.queue?.max;
  const queueTimeoutMs = limits.queue?.timeout;

  let active = 0;
  const waitQueue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active++;
      return Promise.resolve();
    }
    if (maxQueue != null && waitQueue.length >= maxQueue) {
      return Promise.reject(new InternalError('Queued action capacity exceeded'));
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (ok: boolean, err?: InternalError) => {
        if (settled) return;
        settled = true;
        if (ok) resolve();
        else reject(err ?? new InternalError('Queued action rejected'));
      };
      const timer =
        queueTimeoutMs != null
          ? setTimeout(
            () => finish(false, new InternalError('Queued action timed out')),
            queueTimeoutMs,
          )
          : undefined;
      waitQueue.push(() => {
        if (timer != null) clearTimeout(timer);
        finish(true);
      });
    }).then(() => {
      active++;
    });
  }

  function release(): void {
    active--;
    const next = waitQueue.shift();
    if (next != null) next();
  }

  return {
    async run<T>(delegate: () => PromiseMaybe<T>): Promise<T> {
      await acquire();
      try {
        return await delegate();
      } finally {
        release();
      }
    },
  };
}

export function shouldUseLimitGate(server: NexusActionServerOptions | undefined): server is NexusActionServerOptions {
  if (server == null) return false;
  return server.concurrent != null || server.queue != null;
}
