import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InviteDetails } from '../../common/internalActions';
import { performWebAuthnRegistration } from './webauthnRegistration';

// ─── Stub browser-level dependencies ─────────────────────────────────────────

vi.mock('./collectDeviceDetails', () => ({
  collectDeviceDetails: vi.fn(() => ({
    userAgent: 'test-agent', platform: 'test-platform', language: 'en-GB',
    hardwareConcurrency: 4, maxTouchPoints: 0, vendor: 'test-vendor',
    screenWidth: 1280, screenHeight: 720, viewportWidth: 1280, viewportHeight: 720,
    colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
  })),
}));

const fakePrfBuffer = new Uint8Array([5, 6, 7, 8]).buffer;

vi.mock('./webauthnUtils', () => ({
  getPrfResult: vi.fn(() => fakePrfBuffer),
  computeKeyHash: vi.fn(async () => 'reg-keyhash'),
  getRpId: vi.fn(() => 'test-rp-id'),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInviteDetails(overrides: Partial<InviteDetails> = {}): InviteDetails {
  return {
    domain: 'test-rp-id',
    appName: 'Test App',
    userName: 'Alice',
    userHandle: 'handle-alice',
    ...overrides,
  };
}

function makeCredential(): PublicKeyCredential {
  return {
    type: 'public-key',
    id: 'cred-id',
    rawId: new ArrayBuffer(8),
    response: {} as AuthenticatorResponse,
    authenticatorAttachment: null,
    getClientExtensionResults: () => ({ prf: { results: { first: fakePrfBuffer } } }),
  } as unknown as PublicKeyCredential;
}

function mockNavigatorCredentialsCreate(result: PublicKeyCredential | null) {
  Object.defineProperty(globalThis.navigator, 'credentials', {
    value: { create: vi.fn().mockResolvedValue(result) },
    configurable: true,
    writable: true,
  });
}

function getLastCreateOptions() {
  return (navigator.credentials.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
    publicKey: PublicKeyCredentialCreationOptions & {
      extensions: { prf: { eval: { first: BufferSource } } };
    };
  };
}

const mockReplaceState = vi.fn();

function setLocation(search: string, href: string) {
  vi.stubGlobal('window', {
    ...window,
    location: { ...window.location, search, href },
    history: { ...window.history, replaceState: mockReplaceState },
  });
}

function makeCallers(inviteDetails = makeInviteDetails()) {
  const callInvite = vi.fn(async () => ({ registrationToken: 'reg-token-123', inviteDetails }));
  const callRegister = vi.fn(async () => ({ userId: 'user-42', accountId: undefined as string | undefined }));
  return { callInvite, callRegister };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('performWebAuthnRegistration', () => {
  const reconnect = vi.fn();

  beforeEach(() => {
    vi.unstubAllGlobals();
    setLocation('?requestId=req-abc', 'http://localhost/?requestId=req-abc');
    vi.clearAllMocks();
    mockNavigatorCredentialsCreate(makeCredential());
  });

  // --- Prerequisites ---

  it('throws when requestId is absent from the URL', async () => {
    setLocation('', 'http://localhost/');
    const { callInvite, callRegister } = makeCallers();
    await expect(performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined))
      .rejects.toThrow('WebAuthn registration requires a ?requestId= query parameter');
  });

  it('calls callInvite with the requestId extracted from the URL', async () => {
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    expect(callInvite).toHaveBeenCalledWith({ requestId: 'req-abc' });
  });

  // --- credentials.create params ---

  it('encodes registrationToken as the challenge', async () => {
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    const challenge = new TextDecoder().decode(opts.publicKey.challenge as ArrayBuffer);
    expect(challenge).toBe('reg-token-123');
  });

  it('uses getRpId() as rp.id — consistent with the reauth ceremony', async () => {
    const { getRpId } = await import('./webauthnUtils');
    vi.mocked(getRpId).mockReturnValueOnce('custom-rp-id');
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    expect((opts.publicKey.rp as PublicKeyCredentialRpEntity).id).toBe('custom-rp-id');
  });

  it('uses "socket-api-auth" as the PRF extension eval label — consistent with reauth', async () => {
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    const label = new TextDecoder().decode(opts.publicKey.extensions.prf.eval.first as ArrayBuffer);
    expect(label).toBe('socket-api-auth');
  });

  it('encodes inviteDetails.userHandle as user.id', async () => {
    const { callInvite, callRegister } = makeCallers(makeInviteDetails({ userHandle: 'handle-alice' }));
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    const userId = new TextDecoder().decode(opts.publicKey.user.id as ArrayBuffer);
    expect(userId).toBe('handle-alice');
  });

  it('sets user.name to userName when accountName is absent', async () => {
    const { callInvite, callRegister } = makeCallers(makeInviteDetails({ userName: 'Alice', accountName: undefined }));
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    expect(opts.publicKey.user.name).toBe('Alice');
  });

  it('appends accountName in parentheses to user.name when accountName is present', async () => {
    const { callInvite, callRegister } = makeCallers(makeInviteDetails({ userName: 'Alice', accountName: 'Acme Corp' }));
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    expect(opts.publicKey.user.name).toBe('Alice (Acme Corp)');
  });

  it('sets user.displayName to inviteDetails.userName regardless of accountName', async () => {
    const { callInvite, callRegister } = makeCallers(makeInviteDetails({ userName: 'Alice', accountName: 'Acme Corp' }));
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    expect(opts.publicKey.user.displayName).toBe('Alice');
  });

  it('sets rp.name to inviteDetails.appName', async () => {
    const { callInvite, callRegister } = makeCallers(makeInviteDetails({ appName: 'My App' }));
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    expect((opts.publicKey.rp as PublicKeyCredentialRpEntity).name).toBe('My App');
  });

  it('requires residentKey in authenticatorSelection', async () => {
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    expect(opts.publicKey.authenticatorSelection?.residentKey).toBe('required');
  });

  it('requires userVerification in authenticatorSelection', async () => {
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    const opts = getLastCreateOptions();
    expect(opts.publicKey.authenticatorSelection?.userVerification).toBe('required');
  });

  // --- callRegister call ---

  it('calls callRegister with registrationToken, keyHash, and deviceDetails', async () => {
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    expect(callRegister).toHaveBeenCalledWith({
      registrationToken: 'reg-token-123',
      keyHash: 'reg-keyhash',
      deviceDetails: expect.objectContaining({ userAgent: 'test-agent' }),
    });
  });

  // --- Post-registration side effects ---

  it('removes the requestId query parameter from the URL after registration', async () => {
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    expect(mockReplaceState).toHaveBeenCalledOnce();
    const newUrl: string = mockReplaceState.mock.calls[0]![2];
    expect(newUrl).not.toContain('requestId');
  });

  it('calls onPrf with userId, PRF buffer, and undefined accountId when not account-scoped', async () => {
    const onPrf = vi.fn();
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, onPrf);
    expect(onPrf).toHaveBeenCalledWith('user-42', fakePrfBuffer, undefined);
  });

  it('passes accountId to onPrf when the register response includes one', async () => {
    const onPrf = vi.fn();
    const { callInvite, callRegister } = makeCallers();
    callRegister.mockResolvedValueOnce({ userId: 'user-42', accountId: 'acct-7' });
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, onPrf);
    expect(onPrf).toHaveBeenCalledWith('user-42', fakePrfBuffer, 'acct-7');
  });

  it('does not call onPrf when onPrf is undefined', async () => {
    const { callInvite, callRegister } = makeCallers();
    await expect(performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined)).resolves.toBeUndefined();
  });

  it('calls reconnect after successful registration', async () => {
    const { callInvite, callRegister } = makeCallers();
    await performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined);
    expect(reconnect).toHaveBeenCalledOnce();
  });

  // --- Error paths ---

  it('throws when navigator.credentials.create returns null (cancelled)', async () => {
    mockNavigatorCredentialsCreate(null);
    const { callInvite, callRegister } = makeCallers();
    await expect(performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined))
      .rejects.toThrow('Passkey creation cancelled or failed');
  });

  it('does not call reconnect when credential creation is cancelled', async () => {
    mockNavigatorCredentialsCreate(null);
    const { callInvite, callRegister } = makeCallers();
    await expect(performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('throws when getPrfResult returns undefined (PRF not supported)', async () => {
    const { getPrfResult } = await import('./webauthnUtils');
    vi.mocked(getPrfResult).mockReturnValueOnce(undefined);
    const { callInvite, callRegister } = makeCallers();
    await expect(performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined))
      .rejects.toThrow('WebAuthn PRF extension not supported by this authenticator');
  });

  it('does not call reconnect when callRegister throws', async () => {
    const { callInvite, callRegister } = makeCallers();
    callRegister.mockRejectedValueOnce(new Error('register failed'));
    await expect(performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('propagates errors from callInvite', async () => {
    const { callInvite, callRegister } = makeCallers();
    callInvite.mockRejectedValueOnce(new Error('invite failed'));
    await expect(performWebAuthnRegistration(callInvite, callRegister, reconnect, undefined))
      .rejects.toThrow('invite failed');
  });
});
