/**
 * The JSON a client sends for a passkey ceremony: the browser's credential with every binary field base64url-encoded,
 * the shape WebAuthn's own `PublicKeyCredential.toJSON()` produces (and @simplewebauthn's server functions read). The
 * server verifies these (sc-627): the key hash derived from the PRF output is no longer a credential.
 */

/** A passkey registration (`navigator.credentials.create`). */
export interface WebAuthnRegistrationCredentialJson {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
}

/** A passkey sign-in (`navigator.credentials.get`). */
export interface WebAuthnAssertionCredentialJson {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
}
