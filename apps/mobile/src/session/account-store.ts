import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AccountEnd } from './account-session';

/** The signed-in account as the screens show it; not secret (K1). */
export interface AccountUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly isEmailVerified: boolean;
}

/** A card shown once in Settings (frames A8, A8b, G7). */
export type AccountNotice = 'signed-out-elsewhere' | 'session-ended' | 'phone-moved';

export interface AccountState {
  user: AccountUser | null;
  /** The last account signed in on this phone: a different one next is frame G7 (K3). */
  lastAccountId: string | null;
  notice: AccountNotice | null;
  /** Frame A8 also tops Favourites, the first time it opens after (K2). */
  favouritesNotice: boolean;
  /** The address a change was sent to, until `/users/me` shows it (frame A3b, K11). */
  pendingEmail: string | null;
  /** The Favourites offer was dismissed on this phone (frame E2, K19). */
  offerDismissed: boolean;
}

const none: AccountState = {
  user: null,
  lastAccountId: null,
  notice: null,
  favouritesNotice: false,
  pendingEmail: null,
  offerDismissed: false,
};

export const useAccountStore = create<AccountState>()(
  persist(() => ({ ...none }), {
    name: 'wayfare.account',
    storage: createJSONStorage(() => Storage),
  }),
);

/** The session ended by itself: A8 when it was ended elsewhere, A8b when it simply ran out (K2). */
export function accountEnded(reason: AccountEnd): void {
  useAccountStore.setState({
    user: null,
    pendingEmail: null,
    notice: reason === 'elsewhere' ? 'signed-out-elsewhere' : 'session-ended',
    favouritesNotice: reason === 'elsewhere',
  });
}

/** *Forget this install*: a new device knows no account. */
export function resetAccountState(): void {
  useAccountStore.setState({ ...none });
}
