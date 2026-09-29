// src/client/auth/webauthnUtils.ts
import type { WebAuthnAssertionCredentialJson, WebAuthnRegistrationCredentialJson } from '../../common/auth';

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

/** Encodes bytes as base64url, without padding: how WebAuthn JSON carries binary fields. */
export function toBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes base64url (with or without padding) to bytes, as a plain ArrayBuffer: a BufferSource for navigator.credentials
 * in every TypeScript lib, so apps compiling nexus's source on an older TypeScript (5.3) type-check too.
 */
export function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/**
 * A created passkey as the JSON the server verifies (sc-627). The client extension results are left out: they may hold
 * the PRF output, which is this device's secret and never leaves it.
 */
export function toRegistrationJson(credential: PublicKeyCredential): WebAuthnRegistrationCredentialJson {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      ...(typeof response.getTransports === 'function' ? { transports: response.getTransports() } : {}),
    },
    clientExtensionResults: {},
    ...(credential.authenticatorAttachment != null ? { authenticatorAttachment: credential.authenticatorAttachment } : {}),
  };
}

/** A passkey sign-in as the JSON the server verifies (sc-627); like registration, without the PRF output. */
export function toAssertionJson(credential: PublicKeyCredential): WebAuthnAssertionCredentialJson {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      ...(response.userHandle != null ? { userHandle: toBase64Url(response.userHandle) } : {}),
    },
    clientExtensionResults: {},
    ...(credential.authenticatorAttachment != null ? { authenticatorAttachment: credential.authenticatorAttachment } : {}),
  };
}
