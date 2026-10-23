// The suite's accounts (§3.2): identity's dev seed gives the admin; everything else is set up
// through the API and real flows — owners by registering and being approved, the notifications by
// those decisions — and the bounced address in identity's database, a row only identity reads.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Actor,
  clearMail,
  envValue,
  identitySql,
  mailTo,
  REPO,
  resetRateLimits,
} from './support/stack';
import type { Accounts } from './support/accounts';
import { ACCOUNTS_FILE } from './support/accounts';

const PASSWORD = 'console e2e password';
/** The walks' local super admin (services/gateway/scripts), which may sign roles and staff in. */
const SUPER_ADMIN = {
  email: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? 'superadmin@wayfare.local',
  password: process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD ?? 'super admin pass 1',
};
const OWNER_AGREEMENT = '2026-09-01';

async function verifiedUser(email: string): Promise<Actor> {
  const actor = new Actor();
  await actor.call('POST', '/auth/register', {
    email,
    password: PASSWORD,
    preferredLocale: 'en',
    termsVersion: '2026-09-01',
  });
  const { token } = await mailTo(email, /Confirm your email/);
  await actor.call('POST', '/auth/email/verify', { token });
  await actor.call('POST', '/auth/refresh', {});
  return actor;
}

async function apply(actor: Actor, name: string): Promise<string> {
  const { data } = await actor.call<{ data: { registration: { id: string } } }>(
    'POST',
    '/owner/registration',
    {
      businessName: name,
      businessAddress: '12 Lê Lợi, Quận 1',
      contactName: 'Nguyễn Văn An',
      contactPhone: '+84901234567',
      nationalId: '079 201 001 234',
      ownerAgreementVersion: OWNER_AGREEMENT,
    },
  );
  return data.registration.id;
}

/** A verified owner: registered, applied, approved (and, with `rejectFirst`, rejected once before). */
async function owner(reviewer: Actor, email: string, rejectFirst: boolean): Promise<Actor> {
  const actor = await verifiedUser(email);
  if (rejectFirst) {
    const first = await apply(actor, `Quán thử ${email}`);
    await reviewer.call('POST', `/admin/owner-registrations/${first}/reject`, {
      decisionNote: 'Please add the stall’s address.',
    });
  }
  const id = await apply(actor, `Quán ${email}`);
  await reviewer.call('POST', `/admin/owner-registrations/${id}/approve`, {
    decisionNote: 'Welcome aboard.',
  });
  return actor;
}

const roleId = async (superAdmin: Actor, code: string) => {
  const { data } = await superAdmin.call<{
    data: { id: string; code: string | null; name: string }[];
  }>('GET', '/admin/roles');
  const role = data.find((entry) => entry.code === code);
  if (role === undefined) throw new Error(`no role ${code}`);
  return role.id;
};

export default async function globalSetup(): Promise<void> {
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
  await owner(admin, ownerStaffEmail, false);
  const { data: found } = await superAdmin.call<{
    data: { id: string; roles: { id: string }[] }[];
  }>('GET', `/admin/users?q=${encodeURIComponent(ownerStaffEmail)}`);
  const ownerStaff = found[0]!;
  await superAdmin.call('PUT', `/admin/users/${ownerStaff.id}/roles`, {
    roleIds: [
      ...ownerStaff.roles.map((role) => role.id),
      await roleId(superAdmin, 'CONTENT_MODERATOR'),
    ],
  });

  // C8b: a narrow role — submissions only — on a staff account set up from its emailed link.
  const { data: narrowRole } = await superAdmin.call<{ data: { role: { id: string } } }>(
    'POST',
    '/admin/roles',
    {
      name: `Submissions reader ${stamp}`,
      permissionCodes: ['submission.read'],
    },
  );
  const narrowEmail = `narrow-${stamp}@example.com`;
  await superAdmin.call('POST', '/admin/users', {
    email: narrowEmail,
    fullName: 'Lan Pham',
    roleIds: [narrowRole.role.id],
  });
  const setup = await mailTo(narrowEmail, /console account is ready/);
  await new Actor().call('POST', '/auth/password/reset', {
    token: setup.token,
    newPassword: PASSWORD,
  });

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
    bounced: bouncedEmail,
  };
  mkdirSync(resolve(ACCOUNTS_FILE, '..'), { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts));
  resetRateLimits();
}
