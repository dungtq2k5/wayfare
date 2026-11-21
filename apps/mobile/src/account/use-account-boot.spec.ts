// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '@wayfare/ui/testing';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => router }));
const session = vi.hoisted(() => ({ isSignedIn: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../session', () => ({ accountSession: session }));
const actions = vi.hoisted(() => ({
  refreshMe: vi.fn(() => Promise.resolve()),
  outdatedTerms: vi.fn(() => Promise.resolve<string[]>([])),
}));
vi.mock('./actions', () => actions);

const { useAccountBoot } = await import('./use-account-boot');

const boot = async (enabled = true) => {
  await renderHook(() => useAccountBoot(enabled));
  await settle();
};

describe('the account at launch (K2, K16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.isSignedIn.mockResolvedValue(true);
  });

  it('reads the account, then asks for new terms before it is used', async () => {
    actions.outdatedTerms.mockResolvedValueOnce(['TERMS_OF_SERVICE']);
    await boot();
    expect(actions.refreshMe).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/account/terms');
  });

  it('asks nothing when the terms are current', async () => {
    await boot();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does nothing before it is enabled, or signed out', async () => {
    await boot(false);
    session.isSignedIn.mockResolvedValue(false);
    await boot();
    expect(actions.refreshMe).not.toHaveBeenCalled();
  });

  it('stops when the refresh ended the session', async () => {
    session.isSignedIn.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await boot();
    expect(actions.outdatedTerms).not.toHaveBeenCalled();
  });

  it('waits for the next launch when offline', async () => {
    actions.refreshMe.mockRejectedValueOnce(new Error('offline'));
    await boot();
    expect(router.push).not.toHaveBeenCalled();
  });
});
