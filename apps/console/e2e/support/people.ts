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
export async function apply(actor: Actor, name: string): Promise<string> {
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
