import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Written by the global setup; local to the run (gitignored with test-results/). */
export const ACCOUNTS_FILE = resolve(__dirname, '../../test-results/.accounts.json');

export interface Accounts {
  /** Every account the setup made signs in with it. */
  readonly password: string;
  readonly admin: { readonly email: string; readonly password: string };
  readonly owner: string;
  readonly ownerStaff: string;
  readonly narrow: string;
  /** A custom role: `place.read` and `place.update` only (L2m). */
  readonly editor: string;
  readonly bounced: string;
}

export const accounts = (): Accounts => JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) as Accounts;
