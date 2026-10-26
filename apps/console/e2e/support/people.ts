// People the flows need, made through the API as a real person would: verified accounts, owner
// applications, and owners approved by a reviewer.
import { Actor, mailTo } from './stack';

export const PASSWORD = 'console e2e password';
const OWNER_AGREEMENT = '2026-09-01';

/** A registered account with its email confirmed, signed in. */
export async function verifiedUser(email: string): Promise<Actor> {
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

/** An owner application, pending; its id. */
export async function apply(
  actor: Actor,
  name: string,
  more: { businessRegistrationNo?: string; applicantNote?: string } = {},
): Promise<string> {
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
      ...more,
    },
  );
  return data.registration.id;
}

/** A verified owner: registered, applied, approved (and, with `rejectFirst`, rejected once before). */
export async function owner(reviewer: Actor, email: string, rejectFirst = false): Promise<Actor> {
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
  // The owner's token carries the new permission after a refresh.
  await actor.call('POST', '/auth/refresh', {});
  return actor;
}

/** The walks' local super admin (services/gateway/scripts), which may sign roles and staff in. */
export const SUPER_ADMIN = {
  email: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? 'superadmin@wayfare.local',
  password: process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD ?? 'super admin pass 1',
};

/** A built-in role's id, by its code. */
export async function roleId(superAdmin: Actor, code: string): Promise<string> {
  const { data } = await superAdmin.call<{ data: { id: string; code: string | null }[] }>(
    'GET',
    '/admin/roles',
  );
  const role = data.find((entry) => entry.code === code);
  if (role === undefined) throw new Error(`no role ${code}`);
  return role.id;
}

/** A role made for one purpose; its id. */
export async function customRole(
  superAdmin: Actor,
  name: string,
  permissionCodes: string[],
): Promise<string> {
  const { data } = await superAdmin.call<{ data: { role: { id: string } } }>(
    'POST',
    '/admin/roles',
    { name, permissionCodes },
  );
  return data.role.id;
}

/** A staff account, set up from its emailed link with {@link PASSWORD}. */
export async function staff(
  superAdmin: Actor,
  email: string,
  fullName: string,
  roleIds: string[],
): Promise<void> {
  await superAdmin.call('POST', '/admin/users', { email, fullName, roleIds });
  const setup = await mailTo(email, /console account is ready/);
  // Hashing the password can outlast the gateway's deadline on a loaded machine (504) and still
  // finish: the sign-in after it is the proof.
  await new Actor().call(
    'POST',
    '/auth/password/reset',
    { token: setup.token, newPassword: PASSWORD },
    [200, 201, 202, 204, 504],
  );
  await signsIn(email);
}

/** Waits until `email` signs in with {@link PASSWORD}. */
export async function signsIn(email: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await new Actor().signIn(email, PASSWORD);
      return;
    } catch (error) {
      if (attempt >= 15) throw error;
      await new Promise((done) => setTimeout(done, 2_000));
    }
  }
}

/** Adds a built-in role to an account's roles. */
export async function addRole(superAdmin: Actor, email: string, code: string): Promise<void> {
  const { data: found } = await superAdmin.call<{
    data: { id: string; roles: { id: string }[] }[];
  }>('GET', `/admin/users?q=${encodeURIComponent(email)}`);
  const person = found[0]!;
  await superAdmin.call('PUT', `/admin/users/${person.id}/roles`, {
    roleIds: [...person.roles.map((role) => role.id), await roleId(superAdmin, code)],
  });
}
