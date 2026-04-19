interface Entry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  constructor(maxAttempts = 100, windowMs = 60_000) {
    this.#maxAttempts = maxAttempts;
    this.#windowMs = windowMs;
  }

  #maxAttempts: number;
  #windowMs: number;
  #store = new Map<string, Entry>();

  check(ip: string, additionalKey?: string): boolean {
    this.#cleanup();
    const now = Date.now();
    const key = additionalKey != null ? `${ip}:${additionalKey}` : ip;
    let entry = this.#store.get(key);
    if (entry == null || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.#windowMs };
      this.#store.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= this.#maxAttempts;
  }

  reset(ip: string, additionalKey?: string): void {
    const key = additionalKey != null ? `${ip}:${additionalKey}` : ip;
    this.#store.delete(key);
  }

  #cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.#store) {
      if (now >= entry.resetAt) this.#store.delete(key);
    }
  }
}
