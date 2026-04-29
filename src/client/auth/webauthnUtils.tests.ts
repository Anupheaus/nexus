import { describe, it, expect } from 'vitest';
import { computeKeyHash, getPrfResult } from './webauthnUtils';

// ---------------------------------------------------------------------------
// computeKeyHash
// ---------------------------------------------------------------------------
// Purpose: SHA-256 hash an ArrayBuffer and return the hex string.
// ---------------------------------------------------------------------------

describe('computeKeyHash', () => {
  it('returns a 64-character lowercase hex string for non-empty input', async () => {
    const buf = new TextEncoder().encode('hello').buffer;
    const hash = await computeKeyHash(buf as ArrayBuffer);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a deterministic hash for the same input', async () => {
    const buf = new TextEncoder().encode('deterministic').buffer;
    const h1 = await computeKeyHash(buf as ArrayBuffer);
    const h2 = await computeKeyHash(buf as ArrayBuffer);
    expect(h1).toBe(h2);
  });

  it('returns different hashes for different inputs', async () => {
    const buf1 = new TextEncoder().encode('aaa').buffer;
    const buf2 = new TextEncoder().encode('bbb').buffer;
    const h1 = await computeKeyHash(buf1 as ArrayBuffer);
    const h2 = await computeKeyHash(buf2 as ArrayBuffer);
    expect(h1).not.toBe(h2);
  });

  it('produces the same hash as a manual SHA-256 hex computation for the same bytes', async () => {
    // Cross-check: hash produced by computeKeyHash must match the same bytes
    // run through SubtleCrypto manually with the same encoding.
    const bytes = new TextEncoder().encode('cross-check');
    const rawHash = await crypto.subtle.digest('SHA-256', bytes);
    const expected = Array.from(new Uint8Array(rawHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    // computeKeyHash accepts ArrayBuffer; pass the underlying buffer explicitly
    const hash = await computeKeyHash(bytes.buffer as ArrayBuffer);
    expect(hash).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getPrfResult
// ---------------------------------------------------------------------------
// Purpose: Extract the PRF extension output from a PublicKeyCredential,
//          normalising the value to an ArrayBuffer regardless of the raw
//          type returned by the browser (ArrayBuffer, ArrayBufferView, or
//          plain number Array from Chrome).
// ---------------------------------------------------------------------------

function makeCredential(prfFirst: unknown): PublicKeyCredential {
  return {
    getClientExtensionResults: () => ({ prf: { results: { first: prfFirst } } }),
  } as unknown as PublicKeyCredential;
}

function credentialWithNoPrf(): PublicKeyCredential {
  return {
    getClientExtensionResults: () => ({}),
  } as unknown as PublicKeyCredential;
}

describe('getPrfResult', () => {
  it('returns undefined when prf extension is absent', () => {
    expect(getPrfResult(credentialWithNoPrf())).toBeUndefined();
  });

  it('returns undefined when prf.results.first is null', () => {
    expect(getPrfResult(makeCredential(null))).toBeUndefined();
  });

  it('returns undefined when prf.results.first is undefined', () => {
    expect(getPrfResult(makeCredential(undefined))).toBeUndefined();
  });

  it('returns the ArrayBuffer directly when first is already an ArrayBuffer', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const result = getPrfResult(makeCredential(buf));
    expect(result).toBe(buf);
  });

  it('returns the underlying buffer when first is an ArrayBufferView (Uint8Array)', () => {
    const view = new Uint8Array([10, 20, 30]);
    const result = getPrfResult(makeCredential(view));
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([10, 20, 30]));
  });

  it('returns an ArrayBuffer when first is a plain number Array (Chrome behaviour)', () => {
    const arr = [7, 8, 9];
    const result = getPrfResult(makeCredential(arr));
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('returns undefined when first is an unrecognised type (string)', () => {
    // A string is not ArrayBuffer, ArrayBufferView, or Array — should return undefined.
    expect(getPrfResult(makeCredential('unexpected'))).toBeUndefined();
  });
});
