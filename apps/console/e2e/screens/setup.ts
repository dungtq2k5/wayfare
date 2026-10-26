// The screens' global setup: a fresh stack (stack.sh, or CI's just-booted one) gets the people every
// screen draws, with fixed names and addresses, so a baseline changes only when the screen does.
// Each spec then makes the records it draws, also with fixed names; nothing else writes meanwhile.
import {
  apply,
  customRole,
  owner,
  PASSWORD,
  roleId,
  staff,
  SUPER_ADMIN,
  verifiedUser,
  addRole,
  signsIn,
} from '../support/people';
import { Actor, clearMail, identitySql, resetRateLimits } from '../support/stack';
import { startBrowserServer, stopBrowserServer } from './browser';
import { publishMapPacks } from './map-pack';

/** The screens' people, by the names the frames use. Every one signs in with `PASSWORD`. */
export const PEOPLE = {
  /** An admin: the person signed in on most frames. */
  lan: 'lan.pham@example.com',
  /** An owner with a Venue and two notifications (C7, C10, L2b, the submissions). */
  minh: 'minh.tran@example.com',
  /** An owner who is also a content moderator (C8a). */
  an: 'an.nguyen@example.com',
  /** A narrow role: submissions only (C8b). */
  thu: 'thu.le@example.com',
  /** A content moderator (L2m, R2 without *Reveal…*). */
  khoa: 'khoa.vo@example.com',
  /** An applicant whose registration waits (R1, R2). */
  hai: 'hai.nguyen@example.com',
  /** An account whose mail bounced (C17). */
  bounced: 'bao.do@example.com',
  /** A second admin, who applies as an owner too (R4b): Lan's own screens stay a staff member's. */
  quang: 'quang.vo@example.com',
} as const;

/**
 * Waits for narration to finish the seed's Places: a fresh stack is busy with them for minutes,
 * and its answers come slowly until it is done.
 */
async function narrationIdle(admin: Actor): Promise<void> {
  const busy = async (status: string) =>
    (
      await admin.call<{ meta: { total: number } }>(
        'GET',
        `/admin/narration/jobs?status=${status}&pageSize=1`,
      )
    ).meta.total;
  const deadline = Date.now() + 15 * 60_000;
  while ((await busy('QUEUED')) + (await busy('RUNNING')) > 0) {
    if (Date.now() > deadline) throw new Error('narration is still busy after 15 minutes');
    await new Promise((done) => setTimeout(done, 5_000));
  }
}

async function named(actor: Actor, fullName: string): Promise<void> {
  await actor.call('PATCH', '/users/me', { fullName });
}

/**
 * Refuses a stack that is not fresh: the baselines would draw last run's records too. Then makes the
 * people, publishes the map pack the Places use, and starts the pinned browser; returns the teardown.
 *
 * `E2E_SCREENS_REUSE=1` runs again on a stack an earlier run set up, to work on a spec: its
 * baselines are not to be kept, since the records the earlier run made are drawn too.
 */
export async function screensSetup(): Promise<() => void> {
  resetRateLimits();
  await clearMail();
  const superAdmin = new Actor();
  await superAdmin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  await narrationIdle(superAdmin);
  const exists = async (email: string) =>
    (
      await superAdmin.call<{ data: unknown[] }>(
        'GET',
        `/admin/users?q=${encodeURIComponent(email)}`,
      )
    ).data.length > 0;
  const reuse = process.env.E2E_SCREENS_REUSE === '1';
  if ((await exists(PEOPLE.lan)) && !reuse) {
    throw new Error(
      'The screens need a fresh stack: run apps/console/e2e/screens/stack.sh reset (README.md)',
    );
  }
  /** Makes a person once: on a reused stack, only the ones an earlier run did not finish. */
  const once = async (email: string, make: () => Promise<void>) => {
    if (!(await exists(email))) await make();
  };

  await once(PEOPLE.lan, async () =>
    staff(superAdmin, PEOPLE.lan, 'Lan Pham', [await roleId(superAdmin, 'ADMIN')]),
  );
  await signsIn(PEOPLE.lan);
  const lan = new Actor();
  await lan.signIn(PEOPLE.lan, PASSWORD);

  await once(PEOPLE.quang, async () =>
    staff(superAdmin, PEOPLE.quang, 'Quang Vo', [await roleId(superAdmin, 'ADMIN')]),
  );
  await once(PEOPLE.minh, async () => named(await owner(lan, PEOPLE.minh, true), 'Minh Tran'));
  await once(PEOPLE.an, async () => {
    await named(await owner(lan, PEOPLE.an), 'An Nguyen');
    await addRole(superAdmin, PEOPLE.an, 'CONTENT_MODERATOR');
  });
  await once(PEOPLE.thu, async () =>
    staff(superAdmin, PEOPLE.thu, 'Thu Le', [
      await customRole(superAdmin, 'Submissions reader', ['submission.read']),
    ]),
  );
  await once(PEOPLE.khoa, async () =>
    staff(superAdmin, PEOPLE.khoa, 'Khoa Vo', [await roleId(superAdmin, 'CONTENT_MODERATOR')]),
  );
  await once(PEOPLE.hai, async () => {
    const hai = await verifiedUser(PEOPLE.hai);
    await named(hai, 'Nguyễn Văn Hải');
    // R1 and R2 draw the registration number and the applicant's note.
    await apply(hai, 'Ốc Vũ', {
      businessRegistrationNo: '0312456789',
      applicantNote: 'Quán ốc của gia đình tôi ở Vĩnh Khánh, mở từ năm 2009.',
    });
  });
  await once(PEOPLE.bounced, async () => named(await verifiedUser(PEOPLE.bounced), 'Bảo Đỗ'));
  identitySql(
    `UPDATE users SET email_bounced_at = coalesce(email_bounced_at, now()) WHERE email = '${PEOPLE.bounced}'`,
  );

  await publishMapPacks(superAdmin);
  resetRateLimits();
  await startBrowserServer();
  return stopBrowserServer;
}
