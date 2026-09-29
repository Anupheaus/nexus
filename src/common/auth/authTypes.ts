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
  keyHash?: string;
  /** SHA-256 hex of the controller origin cookie; binds an emailed invite to the requesting browser. */
  originNonceHash?: string;
}

export interface WebAuthnAuthStore extends NexusAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
  findByKeyHash(keyHash: string): Promise<WebAuthnAuthRecord | undefined>;
  /**
   * Optional, and recommended: atomically applies `patch` to the PENDING invite that holds `registrationToken` (see
   * `isPendingWebAuthnInvite`) and clears the token, resolving the record as it was before, or `undefined` when no
   * pending invite holds it (another registration with the same token got there first). Without it, registration falls
   * back to a find then an update, and two registrations racing on one token could both succeed.
   */
  claimRegistration?(registrationToken: string, patch: Partial<WebAuthnAuthRecord>): Promise<WebAuthnAuthRecord | undefined>;
}

export type { GoogleOAuthAuthRecord, GoogleOAuthAuthStore, GoogleProfile } from './googleOAuthTypes';
