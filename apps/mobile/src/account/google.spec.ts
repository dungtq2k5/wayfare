import { ApiError } from '@wayfare/api-client';
import { GoogleOutcome } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));
const api = vi.hoisted(() => ({
  apiFetch: vi.fn((_path: string, _init: { body: string }) =>
    Promise.resolve({ data: { idToken: 'fake-token' } }),
  ),
  authGoogleConfirm: vi.fn(),
  authGoogleLink: vi.fn(() => Promise.resolve({})),
  authGoogleNonce: vi.fn(() => Promise.resolve({ data: { nonce: 'n1' } })),
  authGoogleSignIn: vi.fn((_body: object) => Promise.resolve({})),
  usersUnlinkGoogle: vi.fn(() => Promise.resolve({})),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
const chooser = vi.hoisted(() => ({
  signInWithGoogle: vi.fn((_client: string, _nonce: string) =>
    Promise.resolve({ idToken: 'real-token', email: 'an@gmail.com' }),
  ),
  googleFailureOf: (error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === 'CANCELLED' || code === 'NO_ACCOUNT' ? code : 'FAILED';
  },
}));
vi.mock('../../modules/google-sign-in/src', () => chooser);
const env = vi.hoisted(() => ({ DIAGNOSTICS_ENABLED: false, GOOGLE_SERVER_CLIENT_ID: 'client' }));
vi.mock('../env', () => env);
const actions = vi.hoisted(() => ({
  favouritesOnPhone: vi.fn(() => Promise.resolve(2)),
  refreshMe: vi.fn(() => Promise.resolve()),
  signedIn: vi.fn((_session: object, favourites: number) =>
    Promise.resolve({ favourites, needsTerms: false }),
  ),
  signIn: vi.fn((_email: string, _password: string) =>
    Promise.resolve({ favourites: 0, needsTerms: true }),
  ),
}));
vi.mock('./actions', () => actions);

const google = await import('./google');
const { useAccountStore, resetAccountState } = await import('../session/account-store');

const answered = (outcome: GoogleOutcome) =>
  api.authGoogleSignIn.mockResolvedValue({ data: { outcome, accessToken: 'a' } });

beforeEach(() => {
  vi.clearAllMocks();
  resetAccountState();
  env.DIAGNOSTICS_ENABLED = false;
  env.GOOGLE_SERVER_CLIENT_ID = 'client';
  google.useFakeGoogle.setState({ enabled: false, pending: null });
});

describe('Continue with Google (K4, K14)', () => {
  it('asks Google for a token carrying this phone’s nonce, and signs in with the phone’s favourites', async () => {
    answered(GoogleOutcome.SIGNED_IN);
    const answer = await google.continueWithGoogle();
    expect(chooser.signInWithGoogle).toHaveBeenCalledWith('client', 'n1');
    expect(api.authGoogleSignIn).toHaveBeenCalledWith({
      idToken: 'real-token',
      preferredLocale: 'en',
    });
    expect(answer).toEqual({
      kind: 'signed-in',
      outcome: GoogleOutcome.SIGNED_IN,
      favourites: 2,
      needsTerms: false,
    });
    expect(useAccountStore.getState().notice).toBeNull();
  });

  it('says once in Settings that the never-confirmed password was removed', async () => {
    answered(GoogleOutcome.LINKED_PASSWORD_REMOVED);
    await google.continueWithGoogle();
    expect(useAccountStore.getState().notice).toBe('password-removed');
  });

  it('asks for the Wayfare password, with the picked address, when the account isn’t Google’s', async () => {
    api.authGoogleSignIn.mockRejectedValue(
      new ApiError(409, 'GOOGLE_LINK_NEEDS_PASSWORD', 'x', { linkTicket: 'lt1' }),
    );
    expect(await google.continueWithGoogle()).toEqual({
      kind: 'needs-password',
      email: 'an@gmail.com',
      linkTicket: 'lt1',
    });
  });

  it('names a refusal the screens explain, and throws one the form says itself', async () => {
    api.authGoogleSignIn.mockRejectedValueOnce(new ApiError(403, 'ACCOUNT_DEACTIVATED', 'x'));
    expect(await google.continueWithGoogle()).toEqual({ kind: 'failed', reason: 'deactivated' });
    api.authGoogleSignIn.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'x'));
    await expect(google.continueWithGoogle()).rejects.toThrow();
  });

  it('ends quietly when the chooser is cancelled, and names an account-less or broken chooser', async () => {
    chooser.signInWithGoogle.mockRejectedValueOnce({ code: 'CANCELLED' });
    expect(await google.continueWithGoogle()).toEqual({ kind: 'cancelled' });
    chooser.signInWithGoogle.mockRejectedValueOnce({ code: 'NO_ACCOUNT' });
    expect(await google.continueWithGoogle()).toEqual({ kind: 'failed', reason: 'no-account' });
    chooser.signInWithGoogle.mockRejectedValueOnce({ code: 'DEVELOPER_ERROR' });
    expect(await google.continueWithGoogle()).toEqual({ kind: 'failed', reason: 'unreachable' });
    expect(api.authGoogleSignIn).not.toHaveBeenCalled();
  });

  it('is unavailable in a build with no Google client', async () => {
    env.GOOGLE_SERVER_CLIENT_ID = '';
    expect(await google.continueWithGoogle()).toEqual({ kind: 'failed', reason: 'unavailable' });
    expect(chooser.signInWithGoogle).not.toHaveBeenCalled();
  });
});

describe('the fake picker (Diagnostics, K12)', () => {
  const choose = async (
    choice: Parameters<NonNullable<ReturnType<typeof google.useFakeGoogle.getState>['pending']>>[0],
  ) => {
    for (let tick = 0; tick < 10 && google.useFakeGoogle.getState().pending === null; tick++)
      await Promise.resolve();
    google.useFakeGoogle.getState().pending!(choice);
  };

  beforeEach(() => {
    env.DIAGNOSTICS_ENABLED = true;
    google.useFakeGoogle.setState({ enabled: true });
  });

  it('mints a token from the stack for the pick, a workspace address carrying its domain', async () => {
    answered(GoogleOutcome.CREATED);
    const answer = google.continueWithGoogle();
    await choose({ email: 'an@school.edu', verified: false, workspace: true });
    await answer;
    expect(JSON.parse(api.apiFetch.mock.calls[0]![1].body)).toEqual({
      email: 'an@school.edu',
      emailVerified: false,
      nonce: 'n1',
      hd: 'school.edu',
    });
    expect(api.authGoogleSignIn).toHaveBeenCalledWith({
      idToken: 'fake-token',
      preferredLocale: 'en',
    });
    expect(google.useFakeGoogle.getState().pending).toBeNull();
    expect(chooser.signInWithGoogle).not.toHaveBeenCalled();
  });

  it('sends no domain for a personal address, and passes the picker’s refusals on', async () => {
    answered(GoogleOutcome.SIGNED_IN);
    const signed = google.continueWithGoogle();
    await choose({ email: 'an@gmail.com', verified: true, workspace: false });
    await signed;
    expect(JSON.parse(api.apiFetch.mock.calls[0]![1].body)).not.toHaveProperty('hd');
    const refused = google.continueWithGoogle();
    await choose('unreachable');
    expect(await refused).toEqual({ kind: 'failed', reason: 'unreachable' });
  });

  it('is not used in a build without Diagnostics, whatever the switch says', async () => {
    env.DIAGNOSTICS_ENABLED = false;
    answered(GoogleOutcome.SIGNED_IN);
    await google.continueWithGoogle();
    expect(chooser.signInWithGoogle).toHaveBeenCalled();
  });
});

describe('Google in the account’s forms (ADR 0064, frames A3g, A7g, K9, U2)', () => {
  it('signs in with the Wayfare password, then links the picked Google account', async () => {
    expect(await google.linkWithPassword('an@gmail.com', 'pw', 'lt1')).toEqual({
      favourites: 0,
      needsTerms: true,
    });
    expect(actions.signIn).toHaveBeenCalledWith('an@gmail.com', 'pw');
    expect(api.authGoogleLink).toHaveBeenCalledWith({ linkTicket: 'lt1' });
    actions.refreshMe.mockRejectedValueOnce(new Error('offline'));
    await expect(google.linkWithPassword('a@b', 'pw', 'lt2')).resolves.toBeDefined();
  });

  it('confirms with Google in place of the password, naming the confirmed address', async () => {
    api.authGoogleConfirm.mockResolvedValue({ data: { confirmation: 'c1' } });
    expect(await google.confirmWithGoogle()).toEqual({
      kind: 'confirmed',
      proof: { confirmation: 'c1' },
      email: 'an@gmail.com',
    });
    expect(api.authGoogleConfirm).toHaveBeenCalledWith({ idToken: 'real-token' });
  });

  it('a confirmation cancelled, refused, or chosen nowhere fails; offline and rate limits throw', async () => {
    chooser.signInWithGoogle.mockRejectedValueOnce({ code: 'CANCELLED' });
    expect(await google.confirmWithGoogle()).toEqual({ kind: 'cancelled' });
    chooser.signInWithGoogle.mockRejectedValueOnce({ code: 'NO_ACCOUNT' });
    expect(await google.confirmWithGoogle()).toEqual({ kind: 'failed' });
    api.authGoogleConfirm.mockRejectedValueOnce(new ApiError(401, 'GOOGLE_MISMATCH', 'x'));
    expect(await google.confirmWithGoogle()).toEqual({ kind: 'failed' });
    api.authGoogleConfirm.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'x'));
    await expect(google.confirmWithGoogle()).rejects.toThrow();
    api.authGoogleConfirm.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'x'));
    await expect(google.confirmWithGoogle()).rejects.toThrow();
    api.authGoogleConfirm.mockRejectedValueOnce(new Error('boom'));
    await expect(google.confirmWithGoogle()).rejects.toThrow('boom');
  });

  it('removes Google sign-in with the current password, and reads the account again', async () => {
    await google.unlinkGoogle('pw');
    expect(api.usersUnlinkGoogle).toHaveBeenCalledWith({ currentPassword: 'pw' });
    expect(actions.refreshMe).toHaveBeenCalled();
  });
});
