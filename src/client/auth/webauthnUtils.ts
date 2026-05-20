// src/client/auth/webauthnUtils.ts

const VISION_DOMAIN = 'vision.lintex.com';
/** Returns the rpId to use for WebAuthn ceremonies.
 *  Subdomains of vision.lintex.com are normalised to the parent domain so a single
 *  passkey works across all subdomains (e.g. dev.vision.lintex.com → vision.lintex.com). */
export function getRpId(): string {
  const { hostname } = window.location;
  if (hostname === VISION_DOMAIN || hostname.endsWith(`.${VISION_DOMAIN}`)) return VISION_DOMAIN;
  return hostname;
}

export async function computeKeyHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getPrfResult(credential: PublicKeyCredential): ArrayBuffer | undefined {
  const result = (credential.getClientExtensionResults() as any).prf?.results?.first;
  if (result == null) return undefined;
  if (result instanceof ArrayBuffer) return result;
  // A typed-array view may cover only a sub-range of its backing buffer, so we
  // must slice using byteOffset/byteLength rather than returning .buffer directly.
  if (ArrayBuffer.isView(result)) return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer;
  // Chrome now returns a plain Array of numbers
  if (Array.isArray(result)) return new Uint8Array(result).buffer;
  return undefined;
}
