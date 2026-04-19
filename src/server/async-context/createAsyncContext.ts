import { AsyncLocalStorage } from 'async_hooks';
import type { SchemaMarker, SetArg, UseReturn } from './types';
import type { AnyFunction } from '@anupheaus/common';
import { is, type AnyObject } from '@anupheaus/common';

const chainStorage = new AsyncLocalStorage<object[]>();

function getChain(): object[] {
  return chainStorage.getStore() ?? [];
}

function assertObject(lookupObject: object, label: string): void {
  if (!is.plainObject(lookupObject) && !is.object(lookupObject)) throw new TypeError(`${label}: lookupObject must be a non-null object`);
}

/** `wrap` overloads: fixed scope object at registration, or scope object derived from delegate args when invoked. */
export type AsyncContextWrap = {
  <F extends (...args: never[]) => unknown>(
    scopeSelector: (...args: Parameters<F>) => AnyObject,
    delegate: F,
  ): F;
  <F extends (...args: never[]) => unknown>(lookupObject: object, delegate: F): F;
  <F extends (...args: never[]) => unknown>(delegate: F): F;
};

export type CreateAsyncContextResult<S extends Record<string, SchemaMarker>> = {
  wrap: AsyncContextWrap;
} & {
  [K in keyof S as `use${Capitalize<string & K>}`]: () => UseReturn<S, K>;
} & {
  [K in keyof S as `set${Capitalize<string & K>}`]: (value: SetArg<S, K>) => void;
};

function capitalizeKey(key: string): string {
  return key.length === 0 ? key : key[0]!.toUpperCase() + key.slice(1);
}

/**
 * Typed AsyncLocalStorage context: scope chain (outer → inner), WeakMaps for scoped keys,
 * Map for globals.
 *
 * - **`wrap(object, delegate)`** — `extendedChain` is `[...parentAtRegistration, object]` (fixed).
 * - **`wrap(scopeSelector, delegate)`** — parent chain is captured at registration; each call runs under
 *   `[...parentAtRegistration, scopeSelector(...args)]` (same `this` / args as `delegate`).
 */
export function createAsyncContext<S extends Record<string, SchemaMarker>>(
  schema: S,
): CreateAsyncContextResult<S> {
  const keys = Object.keys(schema) as (keyof S & string)[];

  const globalValues = new Map<string, unknown>();
  const scopedMaps = new Map<string, WeakMap<object, unknown>>();

  for (const key of keys) {
    scopedMaps.set(key, new WeakMap());
  }

  function wrap(...args: unknown[]) {
    const scopeSelector = args.length > 1 && is.function(args[0]) ? args[0] as (...args: never[]) => object : undefined;
    const object = args.length > 1 && (is.plainObject(args[0]) || is.object(args[0])) ? args[0] as object : undefined;
    const delegate = args.length > 1 && is.function(args[1]) ? args[1] as AnyFunction : args.length === 1 && is.function(args[0]) ? args[0] as AnyFunction : undefined;

    if (delegate == null) throw new Error('wrap: delegate is required');

    if (scopeSelector != null) {
      const parentChainAtRegistration = chainStorage.getStore() ?? [];
      return (...innerArgs: never[]) => {
        const lookupObject = scopeSelector(...innerArgs);
        assertObject(lookupObject, 'wrap (scopeSelector return value)');
        const extendedChain = [...parentChainAtRegistration, lookupObject];
        return chainStorage.run(extendedChain, () => delegate(...innerArgs));
      };
    }

    const parentChain = chainStorage.getStore() ?? [];
    const extendedChain = object != null ? [...parentChain, object] : parentChain;
    return (...innerArgs: never[]) => chainStorage.run(extendedChain, () => delegate(...innerArgs));
  }

  function useKey<K extends keyof S & string>(key: K): UseReturn<S, K> {
    const meta = schema[key]!;
    const chain = getChain();

    const weak = scopedMaps.get(key);
    if (!weak) throw new Error(`use${capitalizeKey(key)}: internal error — no WeakMap for scoped key`);

    for (let i = chain.length - 1; i >= 0; i--) {
      const obj = chain[i]!;
      if (weak.has(obj)) {
        return weak.get(obj) as UseReturn<S, K>;
      }
    }

    if (globalValues.has(key)) {
      return globalValues.get(key) as UseReturn<S, K>;
    }

    if (meta.__kind === 'required') {
      throw new Error(`use${capitalizeKey(key)}: required value "${key}" is not set in scope`);
    }
    return undefined as UseReturn<S, K>;
  }

  function setKey<K extends keyof S & string>(key: K, value: SetArg<S, K>): void {
    const chain = getChain();
    for (let i = chain.length - 1; i >= 0; i--) {
      const obj = chain[i]!;
      const weak = scopedMaps.get(key);
      if (weak) { weak.set(obj, value); return; }
    }
    globalValues.set(key, value);
  }

  const api: Record<string, unknown> = { wrap };

  for (const key of keys) {
    const useName = `use${capitalizeKey(key)}` as const;
    const setName = `set${capitalizeKey(key)}` as const;
    api[useName] = () => useKey(key);
    api[setName] = (value: unknown) => setKey(key, value as never);
  }

  return api as CreateAsyncContextResult<S>;
}
