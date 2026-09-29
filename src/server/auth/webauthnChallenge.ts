import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** How long a sign-in challenge can be answered (sc-627). */
export const WEBAUTHN_CHALLENGE_TTL_MS = 2 * 60 * 1000;
/** How far ahead of this server's clock a challenge may claim to be issued (another server's clock may run fast). */
const CLOCK_SKEW_MS = 5_000;
/** Separates these HMACs from any other made with the same secret (which must not be reused for anything else). */
const DOMAIN_LABEL = 'nexus-webauthn-signin:v1.';

export interface ChallengeSigner {
  /** A fresh challenge (base64url), to send to the client for `navigator.credentials.get`. */
  issue(now: number): string;
  /** When `challenge` (base64url, as the client's `clientDataJSON` carries it) was issued, or `undefined` if it is not one
   *  of ours, was altered, or has expired. */
  verify(challenge: unknown, now: number): { issuedAt: number } | undefined;
}

const toBase64Url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/**
 * Issues and checks sign-in challenges without server state (sc-627). A challenge is `<issuedAt>.<nonce>.<hmac>`, whose
 * HMAC-SHA256 covers the first two parts (under the label `nexus-webauthn-signin:v1.`), so any server holding `secret` can
 * check one another issued. The secret must be used for nothing else. Without a secret
 * (development only; production must configure one) a random one is used, which only this process knows.
 *
 * Single use is enforced per device by the caller: a sign-in must answer a challenge issued after the one its device last
 * answered (`WebAuthnAuthRecord.lastChallengeIssuedAt`).
 */
export function createChallengeSigner(secret: string | undefined): ChallengeSigner {
  const key = secret != null && secret.length > 0 ? secret : randomBytes(32).toString('hex');
  const sign = (body: string) => createHmac('sha256', key).update(`${DOMAIN_LABEL}${body}`).digest();

  return {
    issue(now) {
      const body = `${now}.${randomBytes(16).toString('base64url')}`;
      return toBase64Url(`${body}.${sign(body).toString('base64url')}`);
    },
    verify(challenge, now) {
      if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]+$/.test(challenge)) return undefined;
      const [issuedAtText, nonce, mac, ...rest] = Buffer.from(challenge, 'base64url').toString('utf8').split('.');
      if (issuedAtText == null || nonce == null || mac == null || rest.length > 0 || !/^\d+$/.test(issuedAtText)) return undefined;
      const expected = sign(`${issuedAtText}.${nonce}`);
      const given = Buffer.from(mac, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
      const issuedAt = Number(issuedAtText);
      if (issuedAt > now + CLOCK_SKEW_MS || now - issuedAt > WEBAUTHN_CHALLENGE_TTL_MS) return undefined;
      return { issuedAt };
    },
  };
}
