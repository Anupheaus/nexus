import { Record } from '@anupheaus/common';
import type { DeviceFormFactor } from './deviceFormFactor';

export interface NexusDeviceDetails extends Record {
  userAgent: string;
  platform: string;
  language: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  maxTouchPoints: number;
  vendor: string;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  colorDepth: number;
  pixelRatio: number;
  timezone: string;
  /** Physical device class derived from the signals above; stored so consumers need not re-derive it. */
  formFactor?: DeviceFormFactor;
}

export interface NexusAuthRecord {
  requestId: string;
  sessionToken: string;
  userId: string;
  accountId?: string;
  deviceId: string;
  isEnabled: boolean;
  deviceDetails?: NexusDeviceDetails;
  lastConnectedAt?: number;
  /** Unix timestamp (ms) when the auth record was created — used for invite TTL. */
  createdAt?: number;
}

export interface NexusAuthStore<TRecord extends NexusAuthRecord = NexusAuthRecord> {
  create(record: TRecord): Promise<void>;
  findById(requestId: string): Promise<TRecord | undefined>;
  findBySessionToken(token: string): Promise<TRecord | undefined>;
  findByDevice(userId: string, deviceId: string): Promise<TRecord | undefined>;
  update(requestId: string, patch: Partial<TRecord>): Promise<void>;
}

export interface JwtAuthRecord extends NexusAuthRecord { }
export interface JwtAuthStore extends NexusAuthStore<JwtAuthRecord> { }

export interface WebAuthnAuthRecord extends NexusAuthRecord {
  registrationToken?: string;
  /** Written by nexus before sc-627, and no longer: the server verifies a passkey's signature instead. */
  keyHash?: string;
  /** The registered passkey's credential id (base64url), which a sign-in names (sc-627). */
  credentialId?: string;
  /** The registered passkey's public key (COSE, base64url), which a sign-in's signature is verified against. */
  credentialPublicKey?: string;
  /** The authenticator's signature counter at the last sign-in (0 for authenticators that do not count). */
  credentialCounter?: number;
  /**
   * When the challenge of the last accepted sign-in was issued (unix ms). A sign-in must answer a challenge issued later,
   * so no captured sign-in can be replayed, even from authenticators whose counter stays 0.
   */
  lastChallengeIssuedAt?: number;
  /** SHA-256 hex of the controller origin cookie; binds an emailed invite to the requesting browser. */
  originNonceHash?: string;
}

export interface WebAuthnAuthStore extends NexusAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
  /** Finds the device whose passkey has this credential id (base64url) (sc-627). */
  findByCredentialId(credentialId: string): Promise<WebAuthnAuthRecord | undefined>;
  /**
   * Optional, and recommended: records a verified sign-in in ONE atomic write, only while the device's
   * `lastChallengeIssuedAt` is missing or older than `challengeIssuedAt`, and resolves whether it wrote. Without it, two
   * sign-ins sent together can both pass the replay check before either is recorded, and the recorded challenge time or
   * counter can go backwards (sc-627).
   */
  recordSignIn?(requestId: string, challengeIssuedAt: number, patch: Partial<WebAuthnAuthRecord>): Promise<boolean>;
  /** No longer called by nexus (sc-627); kept so existing stores still type-check. */
  findByKeyHash?(keyHash: string): Promise<WebAuthnAuthRecord | undefined>;
  /**
   * Optional, and recommended: atomically applies `patch` to the PENDING invite that holds `registrationToken` (see
   * `isPendingWebAuthnInvite`) and clears the token, resolving the record as it was before, or `undefined` when no
   * pending invite holds it (another registration with the same token got there first). Without it, registration falls
   * back to a find then an update, and two registrations racing on one token could both succeed.
   */
  claimRegistration?(registrationToken: string, patch: Partial<WebAuthnAuthRecord>): Promise<WebAuthnAuthRecord | undefined>;
}

export type { GoogleOAuthAuthRecord, GoogleOAuthAuthStore, GoogleProfile } from './googleOAuthTypes';
