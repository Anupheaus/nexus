// src/client/auth/webauthnUtils.ts

/**
 * The WebAuthn relying party ID for a ceremony: the one the app configured (`<Nexus rpId>`), else the page's own host.
 * The browser still requires the page's host to be the rpId or a subdomain of it; in an Android app the platform also
 * checks the rpId's Digital Asset Links against the app. (This replaces a hard-coded consumer domain, which was mistyped
 * and never matched anything.)
 */
export function getRpId(configuredRpId?: string): string {
  const configured = configuredRpId?.trim();
  return configured != null && configured.length > 0 ? configured : window.location.hostname;
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
