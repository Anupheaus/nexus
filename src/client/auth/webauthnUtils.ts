// src/client/auth/webauthnUtils.ts

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
  if (ArrayBuffer.isView(result)) return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  // Chrome now returns a plain Array of numbers
  if (Array.isArray(result)) return new Uint8Array(result).buffer;
  return undefined;
}
