import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => {
  const remove = vi.fn();
  return {
    remove,
    GoogleSignIn: {
      signIn: vi.fn((_clientId: string, _nonce: string) =>
        Promise.resolve({ idToken: 't', email: 'a@b' }),
      ),
      signOut: vi.fn(() => Promise.resolve()),
    },
    NoisyAudio: { addListener: vi.fn((_name: string, _listener: () => void) => ({ remove })) },
  };
});
vi.mock('expo', () => ({
  requireNativeModule: (name: 'GoogleSignIn' | 'NoisyAudio') => native[name],
}));

const google = await import('../../modules/google-sign-in/src');
const noisy = await import('../../modules/noisy-audio/src');

describe('Google’s chooser, the native module (ADR 0062)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for a token carrying the nonce, and forgets the pick', async () => {
    expect(await google.signInWithGoogle('client', 'n1')).toEqual({ idToken: 't', email: 'a@b' });
    expect(native.GoogleSignIn.signIn).toHaveBeenCalledWith('client', 'n1');
    await google.forgetGoogleChoice();
    expect(native.GoogleSignIn.signOut).toHaveBeenCalled();
  });

  it('names a cancelled or account-less chooser, and anything else as failed', () => {
    expect(google.googleFailureOf({ code: 'CANCELLED' })).toBe('CANCELLED');
    expect(google.googleFailureOf({ code: 'NO_ACCOUNT' })).toBe('NO_ACCOUNT');
    expect(google.googleFailureOf({ code: 'DEVELOPER_ERROR' })).toBe('FAILED');
    expect(google.googleFailureOf(null)).toBe('FAILED');
  });
});

describe('headphones out, the native module', () => {
  it('calls back when the audio is about to become loud, until stopped', () => {
    const onNoisy = vi.fn();
    const stop = noisy.onBecomingNoisy(onNoisy);
    const [name, listener] = native.NoisyAudio.addListener.mock.calls[0]!;
    expect(name).toBe('onBecomingNoisy');
    listener();
    expect(onNoisy).toHaveBeenCalled();
    stop();
    expect(native.remove).toHaveBeenCalled();
  });
});
