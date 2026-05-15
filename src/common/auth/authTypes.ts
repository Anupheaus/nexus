import { Record } from '@anupheaus/common';

export interface SocketAPIDeviceDetails extends Record {
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
}

export interface SocketAPIAuthRecord {
  requestId: string;
  sessionToken: string;
  userId: string;
  accountId?: string;
  deviceId: string;
  isEnabled: boolean;
  deviceDetails?: SocketAPIDeviceDetails;
  lastConnectedAt?: number;
}

export interface SocketAPIAuthStore<TRecord extends SocketAPIAuthRecord = SocketAPIAuthRecord> {
  create(record: TRecord): Promise<void>;
  findById(requestId: string): Promise<TRecord | undefined>;
  findBySessionToken(token: string): Promise<TRecord | undefined>;
  findByDevice(userId: string, deviceId: string): Promise<TRecord | undefined>;
  update(requestId: string, patch: Partial<TRecord>): Promise<void>;
}

export interface JwtAuthRecord extends SocketAPIAuthRecord { }
export interface JwtAuthStore extends SocketAPIAuthStore<JwtAuthRecord> { }

export interface WebAuthnAuthRecord extends SocketAPIAuthRecord {
  registrationToken?: string;
  keyHash?: string;
}

export interface WebAuthnAuthStore extends SocketAPIAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
  findByKeyHash(keyHash: string): Promise<WebAuthnAuthRecord | undefined>;
}

export type { GoogleOAuthAuthRecord, GoogleOAuthAuthStore, GoogleProfile } from './googleOAuthTypes';
