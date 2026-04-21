import { describe, it, expect, vi } from 'vitest';
import { SocketIOParser } from './SocketIOParser';

// A minimal CONNECT packet (type 0) — reconstruction logic is skipped for this type,
// so it flows straight to the original callback unchanged.
const makePacket = () => ({ type: 0, nsp: '/', data: [] });

describe('SocketIOParser', () => {
  const mockLogger = {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    silly: vi.fn(),
    provide: vi.fn((fn: () => unknown) => fn()),
  };

  it('creates parser with Encoder and Decoder', () => {
    const parser = new SocketIOParser({ logger: mockLogger as never });
    expect(parser.Encoder).toBeDefined();
    expect(parser.Decoder).toBeDefined();
  });

  it('Encoder extends socket.io Encoder', () => {
    const parser = new SocketIOParser({ logger: mockLogger as never });
    expect(parser.Encoder.prototype.encode).toBeDefined();
  });

  it('Decoder extends socket.io Decoder', () => {
    const parser = new SocketIOParser({ logger: mockLogger as never });
    expect(parser.Decoder.prototype.on).toBeDefined();
  });

  describe('CustomDecoder — listener management', () => {
    it('delivers decoded packets to a registered callback', () => {
      const decoder = new (new SocketIOParser({ logger: mockLogger as never })).Decoder();
      const callback = vi.fn();
      decoder.on('decoded', callback);

      (decoder as any).emit('decoded', makePacket());

      expect(callback).toHaveBeenCalledOnce();
    });

    it('removes a registered listener so it no longer fires after off()', () => {
      const decoder = new (new SocketIOParser({ logger: mockLogger as never })).Decoder();
      const callback = vi.fn();
      decoder.on('decoded', callback);
      decoder.off('decoded', callback);

      (decoder as any).emit('decoded', makePacket());

      expect(callback).not.toHaveBeenCalled();
    });

    it('does not remove a listener when off() is called with a different function reference', () => {
      const decoder = new (new SocketIOParser({ logger: mockLogger as never })).Decoder();
      const callback = vi.fn();
      decoder.on('decoded', callback);
      decoder.off('decoded', vi.fn());

      (decoder as any).emit('decoded', makePacket());

      expect(callback).toHaveBeenCalledOnce();
    });

    it('only removes the targeted listener when multiple are registered', () => {
      const decoder = new (new SocketIOParser({ logger: mockLogger as never })).Decoder();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      decoder.on('decoded', callback1);
      decoder.on('decoded', callback2);
      decoder.off('decoded', callback1);

      (decoder as any).emit('decoded', makePacket());

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledOnce();
    });

    it('fires the callback exactly once after an on→off→on cycle — not twice (regression)', () => {
      // Before the fix: CustomDecoder.on() wrapped callbacks but off() never overrode the
      // base, so the original fn was never found in the Emitter's callback list. The listener
      // accumulated on every reconnect, causing each packet to be dispatched N times.
      const decoder = new (new SocketIOParser({ logger: mockLogger as never })).Decoder();
      const callback = vi.fn();

      decoder.on('decoded', callback);
      decoder.off('decoded', callback);
      decoder.on('decoded', callback);

      (decoder as any).emit('decoded', makePacket());

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('is safe to call off() with a callback that was never registered', () => {
      const decoder = new (new SocketIOParser({ logger: mockLogger as never })).Decoder();

      expect(() => decoder.off('decoded', vi.fn())).not.toThrow();
    });
  });
});
