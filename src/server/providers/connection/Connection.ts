export const DEFAULT_CONNECTION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class Connection {
  constructor(id: string, ttlMs: number, onDestroy: () => void) {
    this.id = id;
    this.ttlMs = ttlMs;
    this.onDestroy = onDestroy;
    this.resetTimer();
  }

  private wsCount = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ttlExpired = false;
  private isDestroyed = false;
  private readonly ttlMs: number;
  private readonly onDestroy: () => void;

  readonly id: string;

  /** Called when a WebSocket opens for this connection. */
  openWebSocket(): void {
    this.wsCount++;
  }

  /** Called when a WebSocket closes. Destroys immediately if TTL already expired and no WS remain. */
  closeWebSocket(): void {
    this.wsCount = Math.max(0, this.wsCount - 1);
    if (this.wsCount === 0 && this.ttlExpired) this.destroy();
  }

  /** Called on each REST request — resets the TTL timer. */
  touch(): void {
    this.ttlExpired = false;
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.ttlExpired = true;
      this.timer = null;
      if (this.wsCount === 0) this.destroy();
      // If wsCount > 0, closeWebSocket() will destroy when the last WS closes.
    }, this.ttlMs);
    // Don't block process exit if all work is done.
    (this.timer as NodeJS.Timeout).unref?.();
  }

  private destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.onDestroy();
  }
}
