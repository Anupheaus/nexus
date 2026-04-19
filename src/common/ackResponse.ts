import { Error, is, type PromiseMaybe } from '@anupheaus/common';

export function getErrorFromAckResponse<T>(response: T): { error: Error | undefined; response: T | undefined } {
  if (is.plainObject(response) && 'error' in response) {
    return { error: new Error(response.error as never), response: undefined };
  }
  return { error: undefined, response };
}

export function throwIfAckError<T>(response: T): T {
  const { error, response: ok } = getErrorFromAckResponse(response);
  if (error) throw error;
  return ok as T;
}

/** Runs an action handler; thrown errors become `{ error }` ack payloads.
 *  Only the error message crosses the wire — stack traces and cause chains are stripped
 *  so internal implementation details are never exposed to clients. */
export async function wrapAckHandler<T>(fn: () => PromiseMaybe<T>): Promise<T | { error: Error }> {
  try {
    return await Promise.resolve(fn());
  } catch (error) {
    // Extract just the message and wrap in a fresh native Error so the original stack
    // and cause chain are not serialised over the socket.
    const message = error instanceof globalThis.Error ? error.message : String(error);
    return { error: new Error({ error: new globalThis.Error(message) }) };
  }
}
