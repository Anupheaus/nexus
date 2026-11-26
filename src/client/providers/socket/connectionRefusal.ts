/** The reason the server gives when it refuses a disabled device's connection (see `runSocketAuthMiddleware`). */
export const DEVICE_DISABLED_REFUSAL_REASON = 'device-disabled';

interface ConnectionRefusalData {
  reason?: unknown;
}

/**
 * Why the server refused a socket's connection, read from a `connect_error`: socket.io hands the `data` of the error the
 * server's auth middleware passed to `next` to the client as `error.data`. Undefined for any other connection error (the
 * server is unreachable, a timeout), which says nothing about this device.
 */
export function getConnectionRefusalReason(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const { data } = error as { data?: unknown };
  if (data == null || typeof data !== 'object') return undefined;
  const { reason } = data as ConnectionRefusalData;
  return typeof reason === 'string' && reason.length > 0 ? reason : undefined;
}
