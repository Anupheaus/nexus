import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Connection } from './Connection';

describe('Connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onDestroy after TTL when no WebSocket is open', () => {
    const onDestroy = vi.fn();
    new Connection('c1', 1000, onDestroy);
    vi.advanceTimersByTime(999);
    expect(onDestroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDestroy).toHaveBeenCalledOnce();
  });

  it('does not destroy on TTL when a WebSocket is open', () => {
    const onDestroy = vi.fn();
    const conn = new Connection('c1', 1000, onDestroy);
    conn.openWebSocket();
    vi.advanceTimersByTime(2000);
    expect(onDestroy).not.toHaveBeenCalled();
  });

  it('destroys immediately when last WebSocket closes after TTL has expired', () => {
    const onDestroy = vi.fn();
    const conn = new Connection('c1', 1000, onDestroy);
    conn.openWebSocket();
    vi.advanceTimersByTime(1500); // TTL fires; wsCount still 1
    expect(onDestroy).not.toHaveBeenCalled();
    conn.closeWebSocket();
    expect(onDestroy).toHaveBeenCalledOnce();
  });

  it('does not destroy while any WebSocket remains open (ref counting)', () => {
    const onDestroy = vi.fn();
    const conn = new Connection('c1', 1000, onDestroy);
    conn.openWebSocket();
    conn.openWebSocket();
    vi.advanceTimersByTime(1500); // TTL fires; wsCount = 2
    conn.closeWebSocket();        // wsCount = 1 — must not destroy
    expect(onDestroy).not.toHaveBeenCalled();
    conn.closeWebSocket();        // wsCount = 0 — now destroys
    expect(onDestroy).toHaveBeenCalledOnce();
  });

  it('touch() resets the TTL timer', () => {
    const onDestroy = vi.fn();
    const conn = new Connection('c1', 1000, onDestroy);
    vi.advanceTimersByTime(800);
    conn.touch();                  // reset timer
    vi.advanceTimersByTime(800);   // only 800ms since last touch
    expect(onDestroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);   // 1000ms since last touch
    expect(onDestroy).toHaveBeenCalledOnce();
  });

  it('touch() after TTL fired (WS still open) restarts the timer', () => {
    const onDestroy = vi.fn();
    const conn = new Connection('c1', 1000, onDestroy);
    conn.openWebSocket();
    vi.advanceTimersByTime(1500); // TTL fires; ttlExpired = true, but WS open
    conn.touch();                  // resets ttlExpired and starts fresh timer
    conn.closeWebSocket();         // WS closes — touch reset TTL so should NOT destroy yet
    expect(onDestroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);  // new TTL expires
    expect(onDestroy).toHaveBeenCalledOnce();
  });

  it('calls onDestroy exactly once even if closeWebSocket is called after destruction', () => {
    const onDestroy = vi.fn();
    const conn = new Connection('c1', 1000, onDestroy);
    vi.advanceTimersByTime(1000); // destroyed via TTL
    conn.closeWebSocket();        // spurious call on an already-destroyed connection
    expect(onDestroy).toHaveBeenCalledOnce();
  });
});
