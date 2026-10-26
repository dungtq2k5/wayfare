// The suite's accounts (§3.2): identity's dev seed gives the admin; everything else is set up
// through the API and real flows — owners by registering and being approved, the notifications by
// those decisions — and the bounced address in identity's database, a row only identity reads.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addRole,
  customRole,
  owner,
  PASSWORD,
  staff,
  SUPER_ADMIN,
  verifiedUser,
} from './support/people';
import { Actor, clearMail, envValue, identitySql, REPO, resetRateLimits } from './support/stack';
import { screensSetup } from './screens/setup';
import type { Accounts } from './support/accounts';
import { ACCOUNTS_FILE } from './support/accounts';

export default async function globalSetup(): Promise<(() => void) | void> {
  if (process.env.E2E_SUITE === 'screens') return screensSetup();
  const stamp = Date.now().toString(36);
  resetRateLimits();
  await clearMail();
  execFileSync('pnpm', ['--silent', 'seed:dev'], { cwd: REPO, stdio: 'ignore' });
  execFileSync('pnpm', ['--silent', '--filter', '@wayfare/identity', 'bootstrap:super-admin'], {
    cwd: REPO,
    stdio: 'ignore',
    env: {
      ...process.env,
      BOOTSTRAP_SUPER_ADMIN_EMAIL: SUPER_ADMIN.email,
      BOOTSTRAP_SUPER_ADMIN_PASSWORD: SUPER_ADMIN.password,
    },
  });

  const seedPassword = envValue('identity', 'SEED_ACCOUNT_PASSWORD');
  const admin = new Actor();
  await admin.signIn('admin@wayfare.test', seedPassword);
  const superAdmin = new Actor();
  await superAdmin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);

  // C7, C10: an owner with two notifications — a rejection, then the approval.
  const ownerEmail = `owner-${stamp}@example.com`;
  await owner(admin, ownerEmail, true);

  // C8a: an owner who is also a content moderator.
  const ownerStaffEmail = `owner-staff-${stamp}@example.com`;
  await owner(admin, ownerStaffEmail);
  await addRole(superAdmin, ownerStaffEmail, 'CONTENT_MODERATOR');

  // C8b: a narrow role — submissions only — on a staff account set up from its emailed link.
  const narrowEmail = `narrow-${stamp}@example.com`;
  await staff(superAdmin, narrowEmail, 'Lan Pham', [
    await customRole(superAdmin, `Submissions reader ${stamp}`, ['submission.read']),
  ]);

  // L2m: a custom role that may read and edit Places, nothing more.
  const editorEmail = `editor-${stamp}@example.com`;
  await staff(superAdmin, editorEmail, 'Minh Tran', [
    await customRole(superAdmin, `Place editor ${stamp}`, ['place.read', 'place.update']),
  ]);

  // C17: an account whose mail bounced.
  const bouncedEmail = `bounced-${stamp}@example.com`;
  await verifiedUser(bouncedEmail);
  identitySql(`UPDATE users SET email_bounced_at = now() WHERE email = '${bouncedEmail}'`);

  const accounts: Accounts = {
    password: PASSWORD,
    admin: { email: 'admin@wayfare.test', password: seedPassword },
    owner: ownerEmail,
    ownerStaff: ownerStaffEmail,
    narrow: narrowEmail,
    editor: editorEmail,
    bounced: bouncedEmail,
  };
  mkdirSync(resolve(ACCOUNTS_FILE, '..'), { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts));
  resetRateLimits();
}
