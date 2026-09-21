// Support-assisted account recovery (api-endpoints-plan §1.10, rdm-spec I-14, ADR 0052): two staff
// open and approve it, the real owner can stop it for three days, and only the link to the new
// address changes anything — taking every other live link with it.
import {
  AccountRecoveryStatus,
  ActionTokenPurpose,
  AuditAction,
  NotificationType,
  RECOVERY_EXPIRY_DAYS,
  RECOVERY_HOLD_HOURS,
  RecoveryEvidenceCode,
  SystemRole,
} from '@wayfare/contracts';
import { identityGrpc, recoveryEvidenceCodeProto } from '@wayfare/contracts/grpc';
import type { AccountContext } from '@wayfare/nest-common';
import { buildAccountContext, buildAnonymousContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RecordingEmailProvider } from '../setup/email';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, freshEmail, staffAccount } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof identityServices>;
let mailbox: RecordingEmailProvider;
let opener: AccountContext;
let approver: AccountContext;
let owner: { id: string; email: string };
const anonymous = buildAnonymousContext();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const Status = identityGrpc.AccountRecoveryStatus;

beforeEach(async () => {
  await truncateAll(prisma);
  mailbox = new RecordingEmailProvider();
  services = identityServices(prisma, {}, { mailbox });
  opener = (await staffAccount(prisma, [SystemRole.ADMIN])).context;
  approver = (await staffAccount(prisma, [SystemRole.SUPER_ADMIN])).context;
  owner = await verifiedOwner();
});
afterAll(() => prisma.$disconnect());

/** A live, verified owner — the only kind of account this flow recovers. */
async function verifiedOwner(): Promise<{ id: string; email: string }> {
  const email = freshEmail();
  const row = await prisma.user.create({
    data: { email, isEmailVerified: true, ownerVerifiedAt: new Date() },
    select: { id: true },
  });
  return { id: row.id, email };
}

const codes = (...values: RecoveryEvidenceCode[]) =>
  values.map((value) => recoveryEvidenceCodeProto.toProto(value));

const TWO_CHECKS = codes(
  RecoveryEvidenceCode.PHONE_CALLBACK,
  RecoveryEvidenceCode.BUSINESS_DETAILS_MATCH,
);

const open = (over: Partial<identityGrpc.OpenRecoveryRequest> = {}, as = opener) =>
  services.adminRecoveries.openRecovery(
    {
      userId: owner.id,
      requestedEmail: freshEmail(),
      evidenceCodes: TWO_CHECKS,
      supportReference: 'TICKET-1',
      ...over,
    },
    as,
  );

/** Every mail due is sent; then the newest to the address. An outcome mail carries no token. */
async function lastMail(address: string) {
  await services.dispatcher.idle();
  const mail = mailbox.to(address).at(-1);
  if (mail === undefined) throw new Error(`No mail to ${address}`);
  const token = /#token=([^\s"<]+)/.exec(mail.text);
  return { mail, token: token === null ? '' : decodeURIComponent(token[1]!) };
}

const auditActions = async () =>
  (await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } })).map(
    (row) => (row.payload as { action: AuditAction }).action,
  );

describe('opening a case', () => {
  it('records the codes and the ticket, and tells the owner nothing yet', async () => {
    const requestedEmail = freshEmail();
    const { recovery } = await open({ requestedEmail });
    expect(recovery).toMatchObject({
      status: Status.ACCOUNT_RECOVERY_STATUS_PENDING_APPROVAL,
      userId: owner.id,
      requestedEmail,
      supportReference: 'TICKET-1',
    });
    const row = await prisma.accountRecovery.findFirstOrThrow();
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(
      RECOVERY_EXPIRY_DAYS * DAY_MS,
      -3,
    );
    // The audit row names the checks, never the address (rdm-spec I-14).
    const audited = (await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } })).map(
      (event) => event.payload as { action: AuditAction; metadata: unknown },
    );
    expect(audited).toEqual([
      expect.objectContaining({
        action: AuditAction.ACCOUNT_RECOVERY_OPENED,
        metadata: {
          after: {
            evidenceCodes: [
              RecoveryEvidenceCode.PHONE_CALLBACK,
              RecoveryEvidenceCode.BUSINESS_DETAILS_MATCH,
            ],
            supportReference: 'TICKET-1',
          },
        },
      }),
    ]);
    // Nothing reaches the owner until a second pair of eyes has approved it.
    await services.dispatcher.idle();
    expect(mailbox.sent).toHaveLength(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('refuses thin evidence, a second live case, and an account that is not a verified owner', async () => {
    expect(
      (await errorOf(open({ evidenceCodes: codes(RecoveryEvidenceCode.PHONE_CALLBACK) }))).code,
    ).toBe('RECOVERY_EVIDENCE_INSUFFICIENT');
    expect(
      (
        await errorOf(
          open({
            evidenceCodes: codes(
              RecoveryEvidenceCode.BUSINESS_DETAILS_MATCH,
              RecoveryEvidenceCode.BILLING_KNOWLEDGE,
            ),
          }),
        )
      ).code,
    ).toBe('RECOVERY_EVIDENCE_INSUFFICIENT');

    await open();
    expect((await errorOf(open())).details).toEqual({ status: 'RECOVERY_ALREADY_LIVE' });

    const tourist = await prisma.user.create({
      data: { email: freshEmail(), isEmailVerified: true },
      select: { id: true },
    });
    expect((await errorOf(open({ userId: tourist.id }))).details).toEqual({
      status: 'NOT_AN_OWNER',
    });
  });
});

describe('approval and the hold', () => {
  it('refuses the opener, holds for 72 hours, and tells the old address and the bell', async () => {
    const { recovery } = await open();
    expect(
      (
        await errorOf(
          services.adminRecoveries.approveRecovery({ recoveryId: recovery!.id }, opener),
        )
      ).code,
    ).toBe('RECOVERY_SELF_APPROVAL');

    const approved = await services.adminRecoveries.approveRecovery(
      { recoveryId: recovery!.id },
      approver,
    );
    expect(approved.recovery!.status).toBe(Status.ACCOUNT_RECOVERY_STATUS_ON_HOLD);
    const row = await prisma.accountRecovery.findFirstOrThrow();
    expect(row.holdUntil!.getTime() - Date.now()).toBeCloseTo(RECOVERY_HOLD_HOURS * HOUR_MS, -4);
    expect(row.cancelTokenHash).not.toBeNull();

    // The old address, which is the one the real owner still reads if this is a takeover.
    const { mail } = await lastMail(owner.email);
    expect(mail.subject).toContain('recovering access');
    expect(mail.text).toContain('/recovery/cancel#token=');
    // The bell, too.
    const notification = await prisma.notification.findFirstOrThrow();
    expect(notification).toMatchObject({
      recipientUserId: owner.id,
      type: NotificationType.ACCOUNT_RECOVERY_PENDING,
    });
    // And nothing about the account has changed.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(user).toMatchObject({ email: owner.email, credentialsChangedAt: null });
  });

  it('rejects with a note, ends the case, and clears its token', async () => {
    const { recovery } = await open();
    const rejected = await services.adminRecoveries.rejectRecovery(
      { recoveryId: recovery!.id, decisionNote: 'Could not verify the caller' },
      approver,
    );
    expect(rejected.recovery!.status).toBe(Status.ACCOUNT_RECOVERY_STATUS_REJECTED);
    const row = await prisma.accountRecovery.findFirstOrThrow();
    expect(row.cancelTokenHash).toBeNull();
    expect(await auditActions()).toContain(AuditAction.ACCOUNT_RECOVERY_REJECTED);
    const { mail } = await lastMail(owner.email);
    expect(mail.text).toContain('rejected');
  });
});

describe('the owner stops it', () => {
  it('cancels with the token, refuses the token twice, and lets the owner cancel signed in', async () => {
    const first = await open();
    await services.adminRecoveries.approveRecovery({ recoveryId: first.recovery!.id }, approver);
    const { token } = await lastMail(owner.email);

    await services.accountRecoveries.cancelRecovery(
      { recoveryId: first.recovery!.id, token },
      anonymous,
    );
    expect((await prisma.accountRecovery.findFirstOrThrow()).status).toBe(
      AccountRecoveryStatus.CANCELLED,
    );
    expect(await auditActions()).toContain(AuditAction.ACCOUNT_RECOVERY_CANCELLED_BY_OWNER);
    // The same token again finds no live case, and says only what a bad token says.
    expect(
      (
        await errorOf(
          services.accountRecoveries.cancelRecovery(
            { recoveryId: first.recovery!.id, token },
            anonymous,
          ),
        )
      ).code,
    ).toBe('TOKEN_EXPIRED');

    // A signed-in owner needs no token at all.
    const second = await open();
    await services.accountRecoveries.cancelRecovery(
      { recoveryId: second.recovery!.id },
      buildAccountContextFor(owner.id),
    );
    expect(
      (await prisma.accountRecovery.findUniqueOrThrow({ where: { id: second.recovery!.id } }))
        .status,
    ).toBe(AccountRecoveryStatus.CANCELLED);
  });

  it('tells a signed-in stranger exactly what it tells a bad token', async () => {
    const { recovery } = await open();
    await services.adminRecoveries.approveRecovery({ recoveryId: recovery!.id }, approver);
    const stranger = (await staffAccount(prisma, [])).context;
    expect(
      (
        await errorOf(
          services.accountRecoveries.cancelRecovery({ recoveryId: recovery!.id }, stranger),
        )
      ).code,
    ).toBe('TOKEN_EXPIRED');
    expect(
      (
        await errorOf(
          services.accountRecoveries.cancelRecovery(
            { recoveryId: recovery!.id, token: 'not-a-token' },
            anonymous,
          ),
        )
      ).code,
    ).toBe('TOKEN_EXPIRED');
    expect((await prisma.accountRecovery.findFirstOrThrow()).status).toBe(
      AccountRecoveryStatus.ON_HOLD,
    );
  });
});

describe('the job and completion', () => {
  /** A case approved and advanced past its hold; returns the completion token. */
  async function heldThenSent(requestedEmail: string) {
    const { recovery } = await open({ requestedEmail });
    await services.adminRecoveries.approveRecovery({ recoveryId: recovery!.id }, approver);
    const past = new Date(Date.now() + (RECOVERY_HOLD_HOURS + 1) * HOUR_MS);
    expect(await services.recoveriesAdvance.run(past)).toEqual({ sent: 1, expired: 0 });
    const { token } = await lastMail(requestedEmail);
    return { recoveryId: recovery!.id, token };
  }

  it('sends the link to the requested address once the hold has passed', async () => {
    const requestedEmail = freshEmail();
    const { recoveryId } = await heldThenSent(requestedEmail);
    expect(
      (await prisma.accountRecovery.findUniqueOrThrow({ where: { id: recoveryId } })).status,
    ).toBe(AccountRecoveryStatus.LINK_SENT);
    const { mail } = await lastMail(requestedEmail);
    expect(mail.text).toContain('/recovery/complete#token=');
    expect(
      await prisma.actionToken.count({ where: { purpose: ActionTokenPurpose.ACCOUNT_RECOVERY } }),
    ).toBe(1);
  });

  it('moves the address, the password and the sessions, and kills every other live link', async () => {
    const requestedEmail = freshEmail();
    // A reset and a revert, both live, both minted before the recovery finishes.
    const now = new Date();
    for (const purpose of [
      ActionTokenPurpose.PASSWORD_RESET,
      ActionTokenPurpose.EMAIL_CHANGE_REVERT,
    ]) {
      await prisma.$transaction((tx) =>
        services.links.mint(tx, {
          userId: owner.id,
          purpose,
          targetEmail: owner.email,
          origin: { ip: null, userAgent: null },
          now,
        }),
      );
    }
    const { recoveryId, token } = await heldThenSent(requestedEmail);

    await services.accountRecoveries.completeRecovery(
      { token, newPassword: 'a new long password' },
      anonymous,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(user).toMatchObject({ email: requestedEmail, isEmailVerified: true });
    expect(user.passwordHash).not.toBeNull();
    expect(user.credentialsChangedAt).not.toBeNull();
    expect(user.tokensValidAfter).not.toBeNull();
    expect(
      (await prisma.accountRecovery.findUniqueOrThrow({ where: { id: recoveryId } })).status,
    ).toBe(AccountRecoveryStatus.COMPLETED);

    // Every other live link is dead — the revert above all (rdm-spec I-14).
    const live = await prisma.actionToken.findMany({
      where: { userId: owner.id, usedAt: null, invalidatedAt: null },
      select: { purpose: true },
    });
    expect(live).toEqual([]);

    // Both addresses hear about it, and so does the bell.
    await services.dispatcher.idle();
    const outcomes = mailbox.sent.filter((mail) => mail.subject.includes('recovery'));
    expect(outcomes.map((mail) => mail.to)).toEqual(
      expect.arrayContaining([owner.email, requestedEmail]),
    );
    expect(
      await prisma.notification.count({
        where: { type: NotificationType.ACCOUNT_RECOVERY_COMPLETED },
      }),
    ).toBe(1);
  });

  it('refuses a spent token, a case that was cancelled, and an address taken meanwhile', async () => {
    const requestedEmail = freshEmail();
    const { token } = await heldThenSent(requestedEmail);
    await services.accountRecoveries.completeRecovery(
      { token, newPassword: 'a new long password' },
      anonymous,
    );
    expect(
      (
        await errorOf(
          services.accountRecoveries.completeRecovery(
            { token, newPassword: 'another long password' },
            anonymous,
          ),
        )
      ).code,
    ).toBe('TOKEN_EXPIRED');

    // A second owner, whose requested address someone else takes while the case waits.
    owner = await verifiedOwner();
    const taken = freshEmail();
    const { token: second } = await heldThenSent(taken);
    await prisma.user.create({ data: { email: taken, isEmailVerified: true } });
    expect(
      (
        await errorOf(
          services.accountRecoveries.completeRecovery(
            { token: second, newPassword: 'a third long password' },
            anonymous,
          ),
        )
      ).code,
    ).toBe('EMAIL_TAKEN');
  });

  it('expires a case nobody finished, and its link stops working', async () => {
    const requestedEmail = freshEmail();
    const { token } = await heldThenSent(requestedEmail);
    const late = new Date(Date.now() + (RECOVERY_EXPIRY_DAYS + 1) * DAY_MS);
    expect(await services.recoveriesAdvance.run(late)).toEqual({ sent: 0, expired: 1 });
    const row = await prisma.accountRecovery.findFirstOrThrow();
    expect(row.status).toBe(AccountRecoveryStatus.EXPIRED);
    expect(row.cancelTokenHash).toBeNull();
    expect(await auditActions()).toContain(AuditAction.ACCOUNT_RECOVERY_EXPIRED);
    expect(
      (
        await errorOf(
          services.accountRecoveries.completeRecovery(
            { token, newPassword: 'a new long password' },
            anonymous,
          ),
        )
      ).code,
    ).toBe('TOKEN_EXPIRED');
    const { mail } = await lastMail(owner.email);
    expect(mail.text).toContain('expired');
  });
});

describe('GetSecurityState', () => {
  it('answers the revert window and the credential stamp, and a completed recovery moves it', async () => {
    expect(await services.accountSecurity.getSecurityState({ userId: owner.id })).toEqual({
      revertPendingUntil: undefined,
      credentialsChangedAt: undefined,
    });

    const now = new Date();
    await prisma.$transaction((tx) =>
      services.links.mint(tx, {
        userId: owner.id,
        purpose: ActionTokenPurpose.EMAIL_CHANGE_REVERT,
        targetEmail: owner.email,
        origin: { ip: null, userAgent: null },
        now,
      }),
    );
    const held = await services.accountSecurity.getSecurityState({ userId: owner.id });
    expect(held.revertPendingUntil).toBeDefined();

    const requestedEmail = freshEmail();
    const { recovery } = await open({ requestedEmail });
    await services.adminRecoveries.approveRecovery({ recoveryId: recovery!.id }, approver);
    const past = new Date(Date.now() + (RECOVERY_HOLD_HOURS + 1) * HOUR_MS);
    await services.recoveriesAdvance.run(past);
    const { token } = await lastMail(requestedEmail);
    await services.accountRecoveries.completeRecovery(
      { token, newPassword: 'a new long password' },
      anonymous,
    );

    const after = await services.accountSecurity.getSecurityState({ userId: owner.id });
    expect(after.credentialsChangedAt).toBeDefined();
    // The revert died with the recovery, so nothing holds the payouts but the cooldown.
    expect(after.revertPendingUntil).toBeUndefined();
  });
});

/** A context standing in for the owner's own session. */
function buildAccountContextFor(userId: string): AccountContext {
  return buildAccountContext({ userId });
}
