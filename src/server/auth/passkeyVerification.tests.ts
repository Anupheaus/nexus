import { describe, expect, it } from 'vitest';
import { createSoftwarePasskey } from './softwarePasskey.testing';
import { createChallengeSigner } from './webauthnChallenge';
import { verifyPasskeyRegistration, verifyPasskeySignIn, type PasskeyVerificationConfig } from './passkeyVerification';

// sc-627: a passkey signs in by signing a server challenge, checked against the public key stored when it registered.
// These use a software authenticator, so every check runs on genuine signatures.

const RP_ID = 'vision.lintex.co.uk';
const ORIGIN = 'https://acme.vision.lintex.co.uk';
const APP_ORIGIN = 'android:apk-key-hash:qyInON519T_K4b6Qj_KV4of4j9YeBXoDWRTDdlKIpCo';
const NOW = 1_800_000_000_000;

const config: PasskeyVerificationConfig = {
  rpIds: [RP_ID],
  isAllowedOrigin: origin => origin === ORIGIN || origin === APP_ORIGIN,
};
const signer = createChallengeSigner('a-long-shared-secret-for-tests');
const tokenBytes = (token: string) => new TextEncoder().encode(token);

async function registered(passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN })) {
  const stored = await verifyPasskeyRegistration(config, passkey.register(tokenBytes('reg-token')), 'reg-token');
  return { passkey, stored: { ...stored!, lastChallengeIssuedAt: undefined as number | undefined } };
}

describe('verifyPasskeyRegistration', () => {
  it('accepts a genuine registration, giving the credential id, public key and counter to store', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });

    const stored = await verifyPasskeyRegistration(config, passkey.register(tokenBytes('reg-token')), 'reg-token');

    expect(stored).toEqual({ credentialId: passkey.credentialId, credentialPublicKey: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/), credentialCounter: 0 });
  });

  it('accepts one from the Android app, whose origin is its signing key\'s hash', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: APP_ORIGIN });
    expect(await verifyPasskeyRegistration(config, passkey.register(tokenBytes('reg-token')), 'reg-token')).toBeDefined();
  });

  it.each([
    ['answers another registration token', { token: 'other-token' }, {}],
    ['comes from an origin the app does not allow', {}, { origin: 'https://evil.example' }],
    ['is for another relying party', {}, { rpId: 'evil.example' }],
    ['did not verify the user', {}, { withoutUserVerification: true }],
  ])('refuses a registration that %s', async (_label, { token = 'reg-token' }: { token?: string; }, overrides) => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    expect(await verifyPasskeyRegistration(config, passkey.register(tokenBytes(token), overrides), 'reg-token')).toBeUndefined();
  });

  it.each([null, 'x', { id: { $ne: null } }, { id: 'a', response: {} }])('refuses %j, which is not a registration', async credential => {
    expect(await verifyPasskeyRegistration(config, credential, 'reg-token')).toBeUndefined();
  });
});

describe('verifyPasskeySignIn', () => {
  it('accepts a signature over a fresh challenge, giving the new counter and the challenge\'s issue time', async () => {
    const { passkey, stored } = await registered();
    const challenge = signer.issue(NOW);

    expect(await verifyPasskeySignIn(config, signer, passkey.signIn(challenge), stored, NOW)).toEqual({ credentialCounter: 0, challengeIssuedAt: NOW });
  });

  it('refuses a replay of an earlier sign-in, even inside the challenge\'s lifetime and with a counter that stays 0', async () => {
    const { passkey, stored } = await registered();
    const older = passkey.signIn(signer.issue(NOW));
    const newer = passkey.signIn(signer.issue(NOW + 1_000));
    const accepted = await verifyPasskeySignIn(config, signer, newer, stored, NOW + 2_000);

    const replayed = await verifyPasskeySignIn(config, signer, older, { ...stored, lastChallengeIssuedAt: accepted!.challengeIssuedAt }, NOW + 3_000);
    const sameAgain = await verifyPasskeySignIn(config, signer, newer, { ...stored, lastChallengeIssuedAt: accepted!.challengeIssuedAt }, NOW + 3_000);

    expect({ replayed, sameAgain }).toEqual({ replayed: undefined, sameAgain: undefined });
  });

  it('refuses a counter that went backwards on an authenticator that counts', async () => {
    const { passkey, stored } = await registered();
    const result = await verifyPasskeySignIn(config, signer, passkey.signIn(signer.issue(NOW), { counter: 4 }), { ...stored, credentialCounter: 7 }, NOW);
    expect(result).toBeUndefined();
  });

  it('refuses a signature by another passkey, over a genuine challenge', async () => {
    const { stored } = await registered();
    const impostor = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    expect(await verifyPasskeySignIn(config, signer, impostor.signIn(signer.issue(NOW)), stored, NOW)).toBeUndefined();
  });

  it.each([
    ['a challenge the server never issued', (passkey: ReturnType<typeof createSoftwarePasskey>) => passkey.signIn(Buffer.from('made-up').toString('base64url'))],
    ['an expired challenge', (passkey: ReturnType<typeof createSoftwarePasskey>) => passkey.signIn(signer.issue(NOW - 10 * 60_000))],
    ['an origin the app does not allow', (passkey: ReturnType<typeof createSoftwarePasskey>) => passkey.signIn(signer.issue(NOW), { origin: 'https://evil.example' })],
    ['another relying party', (passkey: ReturnType<typeof createSoftwarePasskey>) => passkey.signIn(signer.issue(NOW), { rpId: 'evil.example' })],
    ['no user verification', (passkey: ReturnType<typeof createSoftwarePasskey>) => passkey.signIn(signer.issue(NOW), { withoutUserVerification: true })],
  ])('refuses a sign-in with %s', async (_label, answer) => {
    const { passkey, stored } = await registered();
    expect(await verifyPasskeySignIn(config, signer, answer(passkey), stored, NOW)).toBeUndefined();
  });

  it('refuses a sign-in whose signature was altered', async () => {
    const { passkey, stored } = await registered();
    const credential = passkey.signIn(signer.issue(NOW));
    const signature = Buffer.from(credential.response.signature, 'base64url');
    signature.writeUInt8(signature.readUInt8(signature.length - 1) ^ 0xff, signature.length - 1);

    const altered = { ...credential, response: { ...credential.response, signature: signature.toString('base64url') } };
    expect(await verifyPasskeySignIn(config, signer, altered, stored, NOW)).toBeUndefined();
  });

  it.each([null, 'x', { id: { $ne: null } }, { id: 'a', response: { clientDataJSON: 1 } }])('refuses %j, which is not a sign-in', async credential => {
    const { stored } = await registered();
    expect(await verifyPasskeySignIn(config, signer, credential, stored, NOW)).toBeUndefined();
  });
});
