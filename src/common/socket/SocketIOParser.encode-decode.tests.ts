import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./deconstruct', () => ({ deconstruct: vi.fn((x: unknown) => x) }));
vi.mock('./reconstruct', () => ({ reconstruct: vi.fn((x: unknown) => x) }));

import { deconstruct } from './deconstruct';
import { reconstruct } from './reconstruct';
import { SocketIOParser } from './SocketIOParser';

const mockLogger = {
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  silly: vi.fn(),
  provide: vi.fn((fn: () => unknown) => fn()),
};

function makeParser() {
  return new SocketIOParser({ logger: mockLogger as never });
}

beforeEach(() => vi.clearAllMocks());

describe('CustomEncoder — type-2 packet transformation', () => {
  it('calls deconstruct on data[1] for type-2 EVENT packets', () => {
    const parser = makeParser();
    const encoder = new parser.Encoder();
    const payload = { foo: 'bar' };
    encoder.encode({ type: 2, nsp: '/', data: ['event', payload] } as any);
    expect(deconstruct).toHaveBeenCalledWith(payload);
  });

  it('does NOT call deconstruct when data[1] is an ArrayBuffer', () => {
    const parser = makeParser();
    const encoder = new parser.Encoder();
    encoder.encode({ type: 2, nsp: '/', data: ['event', new ArrayBuffer(8)] } as any);
    expect(deconstruct).not.toHaveBeenCalled();
  });
});

describe('CustomEncoder — type-3 packet transformation', () => {
  it('calls deconstruct on the entire data array for type-3 ACK packets', () => {
    const parser = makeParser();
    const encoder = new parser.Encoder();
    const data = [{ id: 1 }];
    encoder.encode({ type: 3, nsp: '/', id: 0, data } as any);
    expect(deconstruct).toHaveBeenCalledWith(data);
  });
});

describe('CustomEncoder — non-data packet types', () => {
  it('does NOT call deconstruct for type-0 (CONNECT) packets', () => {
    const parser = makeParser();
    const encoder = new parser.Encoder();
    encoder.encode({ type: 0, nsp: '/' } as any);
    expect(deconstruct).not.toHaveBeenCalled();
  });
});

describe('CustomEncoder — error resilience', () => {
  it('calls logger.error and does not throw when deconstruct throws', () => {
    vi.mocked(deconstruct).mockImplementationOnce(() => { throw new Error('serialise failed'); });
    const parser = makeParser();
    const encoder = new parser.Encoder();
    expect(() => encoder.encode({ type: 2, nsp: '/', data: ['event', { x: 1 }] } as any)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error occurred while deconstructing',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});

describe('CustomDecoder — type-2 packet reconstruction', () => {
  it('calls reconstruct on data[1] for type-2 decoded packets', () => {
    const parser = makeParser();
    const decoder = new parser.Decoder();
    const rawData = { serialised: true };
    const callback = vi.fn();
    decoder.on('decoded', callback);
    (decoder as any).emit('decoded', { type: 2, nsp: '/', data: ['event', rawData] });
    expect(reconstruct).toHaveBeenCalledWith(rawData);
  });

  it('does NOT call reconstruct when data[1] is an ArrayBuffer', () => {
    const parser = makeParser();
    const decoder = new parser.Decoder();
    const callback = vi.fn();
    decoder.on('decoded', callback);
    (decoder as any).emit('decoded', { type: 2, nsp: '/', data: ['event', new ArrayBuffer(4)] });
    expect(reconstruct).not.toHaveBeenCalled();
  });
});

describe('CustomDecoder — type-3 packet reconstruction', () => {
  it('calls reconstruct on data[0] for type-3 ACK decoded packets', () => {
    const parser = makeParser();
    const decoder = new parser.Decoder();
    const rawData = { result: 42 };
    const callback = vi.fn();
    decoder.on('decoded', callback);
    (decoder as any).emit('decoded', { type: 3, nsp: '/', data: [rawData] });
    expect(reconstruct).toHaveBeenCalledWith(rawData);
  });
});

describe('CustomDecoder — error resilience', () => {
  it('calls logger.error and still invokes the callback when reconstruct throws', () => {
    vi.mocked(reconstruct).mockImplementationOnce(() => { throw new Error('deserialise failed'); });
    const parser = makeParser();
    const decoder = new parser.Decoder();
    const callback = vi.fn();
    decoder.on('decoded', callback);
    (decoder as any).emit('decoded', { type: 2, nsp: '/', data: ['event', '{}'] });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error occurred while reconstructing',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(callback).toHaveBeenCalledOnce();
  });
});
