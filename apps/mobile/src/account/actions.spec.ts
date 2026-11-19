import { LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));
const api = vi.hoisted(() => {
  const names = [
    'authLogin',
    'authLogout',
    'authLogoutAll',
    'authRegister',
    'emailChangeConfirmChange',
    'emailChangeRequestChange',
    'emailChangeRequestVerification',
    'emailChangeRevertChange',
    'emailChangeVerify',
    'favoritesList',
    'passwordChange',
    'passwordForgot',
    'passwordReset',
    'passwordValidate',
    'usersAccept',
    'usersAcceptances',
    'usersErase',
    'usersMe',
    'usersUpdate',
  ] as const;
  return Object.fromEntries(
    names.map((name) => [name, vi.fn<(...args: unknown[]) => Promise<unknown>>()]),
  ) as Record<
    (typeof names)[number],
    ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>
  >;
});
vi.mock('@wayfare/api-client', () => api);
const session = vi.hoisted(() => ({
  start: vi.fn((_tokens: object) => Promise.resolve()),
  end: vi.fn(() => Promise.resolve()),
  refreshToken: vi.fn(() => Promise.resolve<string | null>('r1')),
  isSignedIn: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../session', () => ({ accountSession: session }));
const queries = vi.hoisted(() => ({ invalidateQueries: vi.fn(() => Promise.resolve()) }));
vi.mock('../state/query-client', () => ({ queryClient: queries }));
const google = vi.hoisted(() => ({ forgetGoogleChoice: vi.fn(() => Promise.resolve()) }));
vi.mock('../../modules/google-sign-in/src', () => google);
const env = vi.hoisted(() => ({ GOOGLE_SERVER_CLIENT_ID: 'client' }));
vi.mock('../env', () => env);

const actions = await import('./actions');
const { useAccountStore, resetAccountState } = await import('../session/account-store');
const { useAppStore } = await import('../state/app-store');

const user = { id: 'u1', email: 'an@example.com', fullName: 'An', isEmailVerified: true };
const session1 = { accessToken: 'a1', refreshToken: 'r1', user };
const me = (overrides: object = {}) => ({
  data: { user: { ...user, ...overrides }, signIn: { password: true, google: false } },
});
const acceptances = (current: boolean) => ({
  data: [
    { document: LegalDocument.TERMS_OF_SERVICE, current },
    { document: LegalDocument.PRIVACY_POLICY, current: true },
  ],
});
const favourites = (n: number) => ({ data: Array.from({ length: n }, () => ({})) });

beforeEach(() => {
  vi.clearAllMocks();
  resetAccountState();
  useAppStore.setState({ language: 'vi' });
  env.GOOGLE_SERVER_CLIENT_ID = 'client';
  for (const call of Object.values(api)) call.mockResolvedValue({});
  session.isSignedIn.mockResolvedValue(true);
  session.refreshToken.mockResolvedValue('r1');
  api.usersMe.mockResolvedValue(me());
  api.usersAcceptances.mockResolvedValue(acceptances(true));
  api.favoritesList.mockResolvedValue(favourites(0));
});

describe('signing in (K1, K3, K6, K16)', () => {
  it('creates an account with the device’s bearer, in the phone’s language, at the current terms', async () => {
    api.favoritesList.mockResolvedValue(favourites(3));
    api.authRegister.mockResolvedValue({ data: session1 });
    const result = await actions.createAccount({
      email: ' an@example.com ',
      password: 'pw',
      fullName: '  An ',
    });
    expect(api.authRegister).toHaveBeenCalledWith({
      email: 'an@example.com',
      password: 'pw',
      fullName: 'An',
      preferredLocale: 'vi',
      termsVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.TERMS_OF_SERVICE],
    });
    expect(api.favoritesList).toHaveBeenCalledWith({ lang: 'vi', limit: 50 });
    expect(result).toEqual({ favourites: 3, needsTerms: false });
    expect(session.start).toHaveBeenCalledWith({ accessToken: 'a1', refreshToken: 'r1' });
  });

  it('sends no name when none was typed, and English before a language is chosen', async () => {
    useAppStore.setState({ language: null });
    api.authRegister.mockResolvedValue({ data: session1 });
    await actions.createAccount({ email: 'a@b', password: 'pw', fullName: '   ' });
    expect(api.authRegister).toHaveBeenCalledWith(
      expect.not.objectContaining({ fullName: expect.anything() as unknown }),
    );
    expect(api.authRegister.mock.calls[0]![0]).toMatchObject({ preferredLocale: 'en' });
  });

  it('remembers the account, retires the offer, refetches favourites and asks for new terms', async () => {
    api.authLogin.mockResolvedValue({ data: session1 });
    api.usersAcceptances.mockResolvedValue(acceptances(false));
    const result = await actions.signIn(' an@example.com ', 'pw');
    expect(api.authLogin).toHaveBeenCalledWith({ email: 'an@example.com', password: 'pw' });
    expect(result.needsTerms).toBe(true);
    expect(useAccountStore.getState()).toMatchObject({
      user: { id: 'u1', signIn: { password: true, google: false } },
      lastAccountId: 'u1',
      notice: null,
      offerDismissed: true,
    });
    expect(queries.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/v1/me/favorites'],
      refetchType: 'all',
    });
  });

  it('says the phone moved when another account had signed in here before', async () => {
    useAccountStore.setState({ lastAccountId: 'someone-else' });
    api.authLogin.mockResolvedValue({
      data: { ...session1, user: { ...user, fullName: undefined } },
    });
    api.usersMe.mockRejectedValue(new Error('offline'));
    await actions.signIn('a@b', 'pw');
    expect(useAccountStore.getState()).toMatchObject({
      notice: 'phone-moved',
      user: { fullName: null },
    });
  });

  it('counts no favourites on the phone when they can’t be read', async () => {
    api.favoritesList.mockRejectedValue(new Error('offline'));
    expect(await actions.favouritesOnPhone()).toBe(0);
  });
});

describe('signing out (K2, K13)', () => {
  it('revokes the session on the server and ends it here, forgetting Google’s pick', async () => {
    useAccountStore.setState({ user, pendingEmail: 'x@y' });
    await actions.signOut();
    expect(api.authLogout).toHaveBeenCalledWith({ refreshToken: 'r1' }, { anonymous: true });
    expect(session.end).toHaveBeenCalled();
    expect(google.forgetGoogleChoice).toHaveBeenCalled();
    expect(useAccountStore.getState()).toMatchObject({ user: null, pendingEmail: null });
  });

  it('ends it here even when the server can’t be told, or holds no token', async () => {
    api.authLogout.mockRejectedValueOnce(new Error('offline'));
    google.forgetGoogleChoice.mockRejectedValueOnce(new Error('no pick'));
    await actions.signOut();
    session.refreshToken.mockResolvedValueOnce(null);
    env.GOOGLE_SERVER_CLIENT_ID = '';
    await actions.signOut();
    expect(api.authLogout).toHaveBeenCalledTimes(1);
    expect(google.forgetGoogleChoice).toHaveBeenCalledTimes(1);
    expect(session.end).toHaveBeenCalledTimes(2);
  });

  it('signs out on every phone, then here', async () => {
    api.authLogoutAll.mockResolvedValue({});
    await actions.signOutEverywhere();
    expect(api.authLogoutAll).toHaveBeenCalled();
    expect(session.end).toHaveBeenCalled();
  });

  it('deletes the account with the API’s word, whatever was typed, then ends it here', async () => {
    api.usersErase.mockResolvedValue({});
    await actions.deleteAccount({ currentPassword: 'pw' });
    expect(api.usersErase).toHaveBeenCalledWith({ currentPassword: 'pw', confirm: 'DELETE' });
    expect(session.end).toHaveBeenCalled();
  });
});

describe('the account’s details (K11, K12, K16)', () => {
  it('ends a waiting address change once the server shows it', async () => {
    useAccountStore.setState({ pendingEmail: 'new@example.com' });
    api.usersMe.mockResolvedValueOnce(me({ email: 'old@example.com' }));
    await actions.refreshMe();
    expect(useAccountStore.getState().pendingEmail).toBe('new@example.com');
    api.usersMe.mockResolvedValueOnce(me({ email: 'new@example.com' }));
    await actions.refreshMe();
    expect(useAccountStore.getState().pendingEmail).toBeNull();
  });

  it('changes the name trimmed, and reads the account again', async () => {
    await actions.changeName('  Bình ');
    expect(api.usersUpdate).toHaveBeenCalledWith({ fullName: 'Bình' });
    expect(api.usersMe).toHaveBeenCalled();
  });

  it('waits for the new address in lower case until its link is opened', async () => {
    await actions.requestEmailChange(' New@Example.com ', { confirmation: 'c' });
    expect(api.emailChangeRequestChange).toHaveBeenCalledWith({
      newEmail: 'New@Example.com',
      confirmation: 'c',
    });
    expect(useAccountStore.getState().pendingEmail).toBe('new@example.com');
  });

  it('passes the password change, the reset request and the resend straight through', async () => {
    await actions.changePassword('old', 'new');
    await actions.forgotPassword(' an@example.com ');
    await actions.resendVerification();
    expect(api.passwordChange).toHaveBeenCalledWith({ currentPassword: 'old', newPassword: 'new' });
    expect(api.passwordForgot).toHaveBeenCalledWith({ email: 'an@example.com' });
    expect(api.emailChangeRequestVerification).toHaveBeenCalled();
  });

  it('accepts each outdated document at its current version, and nothing current', async () => {
    api.usersAcceptances.mockResolvedValue(acceptances(false));
    await actions.acceptTerms();
    expect(api.usersAccept.mock.calls).toEqual([
      [
        {
          document: LegalDocument.TERMS_OF_SERVICE,
          version: LEGAL_DOCUMENT_VERSIONS[LegalDocument.TERMS_OF_SERVICE],
        },
      ],
    ]);
  });
});

describe('the email links (K9, K10)', () => {
  const answer = (sameAccount: boolean) => ({ data: { emailMasked: 'a***@b', sameAccount } });

  it('verifies, freshening the bearer first, and reads this account again', async () => {
    api.emailChangeVerify.mockResolvedValue(answer(true));
    expect(await actions.openLink('verify', 'tk')).toEqual({
      emailMasked: 'a***@b',
      sameAccount: true,
      signedIn: true,
    });
    expect(api.emailChangeVerify).toHaveBeenCalledWith({ token: 'tk' });
    expect(api.usersMe).toHaveBeenCalledTimes(2);
  });

  it('confirms another account’s change without touching this one', async () => {
    session.isSignedIn.mockResolvedValue(false);
    api.emailChangeConfirmChange.mockResolvedValue(answer(false));
    expect(await actions.openLink('confirm', 'tk')).toMatchObject({ signedIn: false });
    expect(api.usersMe).not.toHaveBeenCalled();
    expect(session.end).not.toHaveBeenCalled();
  });

  it('ends this account’s session here when it reverts its own change', async () => {
    api.emailChangeRevertChange.mockResolvedValue(answer(true));
    api.usersMe.mockRejectedValue(new Error('offline'));
    await actions.openLink('revert', 'tk');
    expect(session.end).toHaveBeenCalled();
  });

  it('reads a reset link before its form', async () => {
    api.passwordValidate.mockResolvedValue({
      data: { emailMasked: 'a***@b', sameAccount: true, extra: 1 },
    });
    expect(await actions.validateReset('tk')).toEqual({
      emailMasked: 'a***@b',
      sameAccount: true,
      signedIn: true,
    });
  });

  it('signs in again at once with the new password when the reset was this phone’s', async () => {
    useAccountStore.setState({ user });
    api.authLogin.mockResolvedValue({ data: session1 });
    const result = await actions.resetPassword('tk', 'new-pw', true);
    expect(api.passwordReset).toHaveBeenCalledWith({ token: 'tk', newPassword: 'new-pw' });
    expect(session.end).toHaveBeenCalled();
    expect(api.authLogin).toHaveBeenCalledWith({ email: 'an@example.com', password: 'new-pw' });
    expect(result).toEqual({ favourites: 0, needsTerms: false });
  });

  it('signs in nowhere when the reset was another account’s, or none is known here', async () => {
    useAccountStore.setState({ user });
    expect(await actions.resetPassword('tk', 'pw', false)).toBeNull();
    useAccountStore.setState({ user: null });
    expect(await actions.resetPassword('tk', 'pw', true)).toBeNull();
    expect(api.authLogin).not.toHaveBeenCalled();
  });
});
