/**
 * The lowest log level this client relays to the server over `nexus.log`. Entries below it stay on the device
 * (they remain in the logger's flight recorder), so a quiet level also means less socket traffic.
 *
 * Module state rather than a prop: the relay listener is registered by `SocketProvider` on every connect, and the app
 * that decides the level (from a server push, for example) lives outside that component. 0 relays everything, which is
 * what the library did before this existed; the server still decides what it keeps.
 */
let relayMinLevel = 0;

/** Sets the lowest level this client relays; the next entry logged follows it. */
export function setClientLogRelayLevel(level: number): void {
  relayMinLevel = level;
}

/** The lowest level this client relays right now. */
export function getClientLogRelayLevel(): number {
  return relayMinLevel;
}
