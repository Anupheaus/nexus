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

// #21 review: web passkeys belong to their own tenant host (tenants are created at runtime), while the native app's
// belong to a fixed parent domain. The relying parties are chosen per ceremony, from its origin.
describe('relying parties chosen per ceremony', () => {
  const TENANT_ORIGIN = 'https://acme.vision.lintex.co.uk';
  const perCeremony: PasskeyVerificationConfig = {
    rpIds: origin => (origin.startsWith('https://') ? [new URL(origin).host] : [RP_ID]),
    isAllowedOrigin: origin => origin === TENANT_ORIGIN || origin === APP_ORIGIN,
  };

  it('accepts a web passkey for its own tenant host, and a native one for the parent domain', async () => {
    const web = createSoftwarePasskey({ rpId: 'acme.vision.lintex.co.uk', origin: TENANT_ORIGIN });
    const native = createSoftwarePasskey({ rpId: RP_ID, origin: APP_ORIGIN });

    const results = [
      await verifyPasskeyRegistration(perCeremony, web.register(tokenBytes('reg-token')), 'reg-token'),
      await verifyPasskeyRegistration(perCeremony, native.register(tokenBytes('reg-token')), 'reg-token'),
    ];
    expect(results.map(result => result?.credentialId)).toEqual([web.credentialId, native.credentialId]);
  });

  it.each([
    ['a web page claiming the parent domain', { rpId: RP_ID, origin: TENANT_ORIGIN }],
    ['the native app claiming a tenant host', { rpId: 'acme.vision.lintex.co.uk', origin: APP_ORIGIN }],
  ])('refuses %s', async (_label, passkeyOptions) => {
    const passkey = createSoftwarePasskey(passkeyOptions);
    expect(await verifyPasskeyRegistration(perCeremony, passkey.register(tokenBytes('reg-token')), 'reg-token')).toBeUndefined();
  });

  it('refuses a ceremony when the origin has no relying party', async () => {
    const none: PasskeyVerificationConfig = { rpIds: () => [], isAllowedOrigin: () => true };
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    expect(await verifyPasskeyRegistration(none, passkey.register(tokenBytes('reg-token')), 'reg-token')).toBeUndefined();
  });
});

// #21 review: a registration token and a sign-in challenge are different things, and neither answers for the other.
describe('challenges are not interchangeable', () => {
  it('refuses a sign-in that signed a registration token instead of an issued challenge', async () => {
    const { passkey, stored } = await registered();
    const tokenAsChallenge = Buffer.from('reg-token').toString('base64url');
    expect(await verifyPasskeySignIn(config, signer, passkey.signIn(tokenAsChallenge), stored, NOW)).toBeUndefined();
  });

  it('refuses a registration that answers an issued sign-in challenge instead of its registration token', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    const signInChallenge = signer.issue(NOW);
    const credential = passkey.register(Buffer.from(signInChallenge, 'base64url'));
    expect(await verifyPasskeyRegistration(config, credential, 'reg-token')).toBeUndefined();
  });
});

describe('failures are reported to the server, never in the result', () => {
  it('passes the reason a ceremony failed to onError', async () => {
    const { passkey, stored } = await registered();
    const errors: unknown[] = [];

    await verifyPasskeySignIn(config, signer, passkey.signIn(signer.issue(NOW), { withoutUserVerification: true }), stored, NOW, error => errors.push(error));

    expect(errors).toEqual([expect.any(Error)]);
  });
});

// #21 verification: every refusal is reported to the server log, and an app's rpIds function that throws refuses the
// ceremony instead of leaking its error to the client.
describe('refusals reported to onError', () => {
  it.each([
    ['a disallowed origin', { rpId: RP_ID, origin: 'https://evil.example' }],
    ['a malformed credential', undefined],
  ])('reports %s', async (_label, passkeyOptions) => {
    const errors: unknown[] = [];
    const credential = passkeyOptions == null ? { id: 'x' } : createSoftwarePasskey(passkeyOptions).register(tokenBytes('reg-token'));
    await verifyPasskeyRegistration(config, credential, 'reg-token', error => errors.push(error));
    expect(errors).toEqual([expect.any(Error)]);
  });

  it('reports a sign-in naming a credential other than the stored one', async () => {
    const { passkey, stored } = await registered();
    const errors: unknown[] = [];
    await verifyPasskeySignIn(config, signer, passkey.signIn(signer.issue(NOW)), { ...stored, credentialId: 'another' }, NOW, error => errors.push(error));
    expect(errors).toEqual([expect.any(Error)]);
  });

  it('refuses, and reports, when the app\'s rpIds function throws, without the error reaching the caller', async () => {
    const throwing: PasskeyVerificationConfig = { rpIds: () => { throw new Error('rpIds exploded'); }, isAllowedOrigin: () => true };
    const errors: unknown[] = [];
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });

    const result = await verifyPasskeyRegistration(throwing, passkey.register(tokenBytes('reg-token')), 'reg-token', error => errors.push(error));

    expect({ result, errors: errors.map(error => (error as Error).message) }).toEqual({ result: undefined, errors: ['rpIds exploded'] });
  });
});

// sc-378: each refusal carries a reason code, which the [Auth] log groups by. The error text is never logged.
describe('reason codes passed to onError', () => {
  type Reasons = string[];
  const collect = (reasons: Reasons) => (_error: unknown, reason: string) => { reasons.push(reason); };

  it.each([
    ['a disallowed origin', { origin: 'https://evil.example' }, 'origin-not-allowed'],
    ['another relying party', { rpId: 'evil.example' }, 'bad-signature'],
    ['no user verification', { withoutUserVerification: true }, 'bad-signature'],
  ])('reports a sign-in with %s as %s', async (_label, overrides, expected) => {
    const { passkey, stored } = await registered();
    const reasons: Reasons = [];
    await verifyPasskeySignIn(config, signer, passkey.signIn(signer.issue(NOW), overrides), stored, NOW, collect(reasons));
    expect(reasons).toEqual([expected]);
  });

  it('reports a malformed sign-in credential as malformed-credential', async () => {
    const { stored } = await registered();
    const reasons: Reasons = [];
    await verifyPasskeySignIn(config, signer, { id: 'a', response: {} }, stored, NOW, collect(reasons));
    expect(reasons).toEqual(['malformed-credential']);
  });

  it('reports a sign-in naming another credential as credential-mismatch', async () => {
    const { passkey, stored } = await registered();
    const reasons: Reasons = [];
    await verifyPasskeySignIn(config, signer, passkey.signIn(signer.issue(NOW)), { ...stored, credentialId: 'another' }, NOW, collect(reasons));
    expect(reasons).toEqual(['credential-mismatch']);
  });

  it('reports a device with no stored passkey as no-registered-passkey', async () => {
    const { passkey, stored } = await registered();
    const reasons: Reasons = [];
    await verifyPasskeySignIn(config, signer, passkey.signIn(signer.issue(NOW)), { ...stored, credentialPublicKey: undefined }, NOW, collect(reasons));
    expect(reasons).toEqual(['no-registered-passkey']);
  });

  it('reports an origin with no relying party as no-relying-party', async () => {
    const none: PasskeyVerificationConfig = { rpIds: () => [], isAllowedOrigin: () => true };
    const reasons: Reasons = [];
    await verifyPasskeyRegistration(none, createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN }).register(tokenBytes('reg-token')), 'reg-token', collect(reasons));
    expect(reasons).toEqual(['no-relying-party']);
  });

  it.each([
    ['an expired challenge', (passkey: ReturnType<typeof createSoftwarePasskey>) => passkey.signIn(signer.issue(NOW - 10 * 60_000)), undefined],
    ['a challenge the server never issued', (passkey: ReturnType<typeof createSoftwarePasskey>) => passkey.signIn(Buffer.from('made-up').toString('base64url')), undefined],
    ['a replayed challenge', (passkey: ReturnType<typeof createSoftwarePasskey>) => passkey.signIn(signer.issue(NOW)), NOW],
  ])('reports a sign-in with %s as challenge-rejected', async (_label, answer, lastChallengeIssuedAt) => {
    const { passkey, stored } = await registered();
    const reasons: Reasons = [];
    await verifyPasskeySignIn(config, signer, answer(passkey), { ...stored, lastChallengeIssuedAt }, NOW, collect(reasons));
    expect(reasons).toEqual(['challenge-rejected']);
  });

  it('reports a registration answering the wrong token as challenge-rejected', async () => {
    const reasons: Reasons = [];
    await verifyPasskeyRegistration(config, createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN }).register(tokenBytes('other-token')), 'reg-token', collect(reasons));
    expect(reasons).toEqual(['challenge-rejected']);
  });

  it('reports an altered signature as bad-signature', async () => {
    const { passkey, stored } = await registered();
    const credential = passkey.signIn(signer.issue(NOW));
    const signature = Buffer.from(credential.response.signature, 'base64url');
    signature.writeUInt8(signature.readUInt8(signature.length - 1) ^ 0xff, signature.length - 1);
    const reasons: Reasons = [];
    await verifyPasskeySignIn(config, signer, { ...credential, response: { ...credential.response, signature: signature.toString('base64url') } }, stored, NOW, collect(reasons));
    expect(reasons).toEqual(['bad-signature']);
  });

  // Pins the /counter/i match on @simplewebauthn's error text: an upgrade that rewords it fails here, not silently.
  it('reports a counter that went backwards as counter-regression', async () => {
    const { passkey, stored } = await registered();
    const reasons: Reasons = [];
    await verifyPasskeySignIn(config, signer, passkey.signIn(signer.issue(NOW), { counter: 4 }), { ...stored, credentialCounter: 7 }, NOW, collect(reasons));
    expect(reasons).toEqual(['counter-regression']);
  });
});
