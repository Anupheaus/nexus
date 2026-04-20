// Browser polyfills for Node.js globals used by packages in this bundle.
import { Buffer } from 'buffer';

(globalThis as any).global = globalThis;
(globalThis as any).Buffer = Buffer;
(globalThis as any).process = {
  env: {},
  pid: 0,
  hrtime: Object.assign((_time?: [number, number]) => [0, 0] as [number, number], {
    bigint: () => BigInt(0),
  }),
  versions: {},
  platform: 'browser',
  nextTick: (fn: () => void) => Promise.resolve().then(fn),
};
