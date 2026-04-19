import { describe, it, expect, vi } from 'vitest';
import { createActionLimitGate } from './actionLimitGate';

describe('createActionLimitGate', () => {
  it('runs delegate directly when no limits are configured', async () => {
    expect(await createActionLimitGate(undefined).run(async () => 42)).toBe(42);
    expect(await createActionLimitGate({}).run(async () => 'ok')).toBe('ok');
  });

  it('allows up to concurrent.max overlapping handlers', async () => {
    const gate = createActionLimitGate({ concurrent: { max: 2 } });
    let unblock1!: () => void;
    let unblock2!: () => void;
    const p1 = gate.run(() => new Promise<void>(r => { unblock1 = r; }));
    const p2 = gate.run(() => new Promise<void>(r => { unblock2 = r; }));
    let thirdRan = false;
    const p3 = gate.run(async () => {
      thirdRan = true;
    });
    await Promise.resolve();
    expect(thirdRan).toBe(false);
    unblock1();
    await p1;
    await p3;
    expect(thirdRan).toBe(true);
    unblock2();
    await p2;
  });

  it('rejects run when wait queue is full', async () => {
    const gate = createActionLimitGate({
      concurrent: { max: 1 },
      queue: { max: 1 },
    });
    let unblock!: () => void;
    const holding = gate.run(() => new Promise<void>(r => { unblock = r; }));
    await Promise.resolve();
    const waiter = gate.run(async () => 'waiter');
    await Promise.resolve();
    await expect(gate.run(async () => 'third')).rejects.toThrow(/capacity exceeded/);
    unblock();
    await holding;
    expect(await waiter).toBe('waiter');
  });

  it('rejects run after queue timeout', async () => {
    vi.useFakeTimers();
    const gate = createActionLimitGate({
      concurrent: { max: 1 },
      queue: { max: 10, timeout: 50 },
    });
    let unblock!: () => void;
    const holding = gate.run(() => new Promise<void>(r => { unblock = r; }));
    await Promise.resolve();
    const late = gate.run(async () => 'late');
    await Promise.resolve();
    const p = expect(late).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(50);
    await p;
    unblock();
    await holding;
    vi.useRealTimers();
  });

  it('defaults to one in-flight when only queue is set', async () => {
    const gate = createActionLimitGate({ queue: { max: 5 } });
    let unblock!: () => void;
    const p1 = gate.run(() => new Promise<void>(r => { unblock = r; }));
    let secondRan = false;
    const p2 = gate.run(async () => {
      secondRan = true;
    });
    await Promise.resolve();
    expect(secondRan).toBe(false);
    unblock();
    await p1;
    await p2;
    expect(secondRan).toBe(true);
  });

  it('releases slot when delegate throws', async () => {
    const gate = createActionLimitGate({ concurrent: { max: 1 } });
    await expect(
      gate.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await gate.run(async () => 'ok')).toBe('ok');
  });
});
