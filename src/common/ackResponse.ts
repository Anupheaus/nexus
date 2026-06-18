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
 *  Known {@link Error} subclasses (e.g. AuthenticationError) are preserved so the
 *  client can reconstruct the original type via `getErrorFromAckResponse`.
 *  For all other thrown values only the message crosses the wire — stack traces and
 *  cause chains are stripped so internal implementation details are never exposed. */
export async function wrapAckHandler<T>(fn: () => PromiseMaybe<T>): Promise<T | { error: Error }> {
  try {
    return await Promise.resolve(fn());
  } catch (error) {
    // If the thrown error is already a known serialisable Error subclass, preserve it
    // so type information (e.g. AuthenticationError) survives the wire.
    if (error instanceof Error) return { error };
    // For native / unknown errors, extract just the message — strips stack traces
    // and cause chains so internal details are never exposed to clients.
    const message = error instanceof globalThis.Error ? error.message : String(error);
    return { error: new Error({ error: new globalThis.Error(message) }) };
  }
}
