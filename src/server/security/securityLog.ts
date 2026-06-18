import { useLogger } from '../async-context/nexusContext';

/** Discriminates the kind of security rejection, for easy filtering/alerting in log aggregation. */
export type SecurityEvent =
  | 'rate-limit'
  | 'cors-origin-blocked'
  | 'transport-blocked'
  | 'unauthorized'
  | 'body-size';

const SUB_LOGGER_NAME = 'Nexus Security';

/**
 * Emit a warning whenever a security measure rejects a request, so blocks (rate limits, CORS, auth,
 * transport, body size) are visible and trackable rather than silent. Every call carries a
 * `securityEvent` discriminator in its meta to make these easy to filter/alert on downstream.
 *
 * Logged through a `'Nexus Security'` sub-logger of the host's logger, so the source is explicit (e.g.
 * `[Host > Nexus Security]`) rather than attributed to whoever created the root logger (e.g. MXDB).
 *
 * Every call site runs inside a request, where the nexus async context (and therefore the logger) is
 * active, so it acquires the logger via `useLogger()` directly — no defensive fallback that could swallow
 * the very events we want tracked. Tests supply a logger with `setLogger(...)`.
 */
export function securityWarn(message: string, meta: { securityEvent: SecurityEvent } & Record<string, unknown>): void {
  useLogger().createSubLogger(SUB_LOGGER_NAME).warn(message, meta);
}
