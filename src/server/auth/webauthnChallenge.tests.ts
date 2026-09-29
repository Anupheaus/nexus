import { describe, expect, it } from 'vitest';
import { createChallengeSigner, WEBAUTHN_CHALLENGE_TTL_MS } from './webauthnChallenge';

// A passkey sign-in answers a challenge the server issued (sc-627). The challenge carries its own proof (an HMAC) and its
// issue time, so any server holding the secret can check it without shared state; it lives two minutes.

const NOW = 1_800_000_000_000;
const signer = createChallengeSigner('a-long-shared-secret-for-tests');
const tamper = (challenge: string, at: number) => `${challenge.slice(0, at)}${challenge[at] === 'A' ? 'B' : 'A'}${challenge.slice(at + 1)}`;

describe('createChallengeSigner', () => {
  it('verifies a challenge it issued, giving the time it was issued', () => {
    expect(signer.verify(signer.issue(NOW), NOW + 1_000)).toEqual({ issuedAt: NOW });
  });

  it('issues a different challenge every time', () => {
    expect(signer.issue(NOW)).not.toBe(signer.issue(NOW));
  });

  it('verifies a challenge on another server holding the same secret', () => {
    expect(createChallengeSigner('a-long-shared-secret-for-tests').verify(signer.issue(NOW), NOW)).toEqual({ issuedAt: NOW });
  });

  it.each([
    ['expired', (challenge: string) => signer.verify(challenge, NOW + WEBAUTHN_CHALLENGE_TTL_MS + 1)],
    ['issued in the future (a clock it cannot trust)', (challenge: string) => signer.verify(challenge, NOW - 60_000)],
    ['signed with another secret', (challenge: string) => createChallengeSigner('another-secret-entirely').verify(challenge, NOW)],
    ['altered', (challenge: string) => signer.verify(tamper(challenge, 5), NOW)],
  ])('refuses a challenge that is %s', (_label, verify) => {
    expect(verify(signer.issue(NOW))).toBeUndefined();
  });

  it.each(['', 'not-base64url!', 'bm90LWEtdG9rZW4', 123, null, { $ne: null }])('refuses %j, which is not a challenge', value => {
    expect(signer.verify(value as never, NOW)).toBeUndefined();
  });

  it('works without a secret, for development, with a random one that only this process knows', () => {
    const local = createChallengeSigner(undefined);
    expect({ own: local.verify(local.issue(NOW), NOW), other: createChallengeSigner(undefined).verify(local.issue(NOW), NOW) }).toEqual({ own: { issuedAt: NOW }, other: undefined });
  });
});
