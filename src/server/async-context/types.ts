/** Runtime marker for schema entries (flat keys on `createAsyncContext`). */
export type SchemaKeyKind = 'required' | 'optional';

export type SchemaMarker = RequiredMarker | OptionalMarker;

export interface RequiredMarker { readonly __kind: 'required'; }
export interface OptionalMarker { readonly __kind: 'optional'; }

/** Required key: `useX()` throws if missing after chain + global walk. */
export function required<T = unknown>(): { readonly __kind: 'required'; readonly _type?: T; } {
  return { __kind: 'required' };
}

/** Optional key: `useX()` may return `undefined`. */
export function optional<T = unknown>(): { readonly __kind: 'optional'; readonly _type?: T; } {
  return { __kind: 'optional' };
}

type Phantom<T> = T extends { readonly _type?: infer V; } ? V : never;

export type InferValue<S extends Record<string, SchemaMarker>, K extends keyof S> = Phantom<S[K]>;

export type UseReturn<S extends Record<string, SchemaMarker>, K extends keyof S> = S[K]['__kind'] extends 'required'
  ? InferValue<S, K>
  : InferValue<S, K> | undefined;

export type SetArg<S extends Record<string, SchemaMarker>, K extends keyof S> = S[K]['__kind'] extends 'required'
  ? InferValue<S, K>
  : InferValue<S, K> | undefined;
