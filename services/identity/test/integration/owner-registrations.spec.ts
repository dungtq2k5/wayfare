// Owner verification (rdm-spec I-8, api-endpoints-plan §1.4, §1.5): applying with the agreement,
// the national ID as ciphertext only, review with its one transaction, reveal with its audit row,
// redaction after the retention period, and erasure's step.
import {
  AUDIT_RECORD,
  AuditAction,
  compareStrings,
  IDENTITY_OWNER_VERIFIED,
  IDENTITY_SESSION_REVOKED,
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
  NotificationType,
  OwnerRegistrationStatus,
  PII_RETENTION_DAYS,
  SystemRole,
} from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { JobRunRecorder, OutboxService } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OwnerPiiRedactJob } from '../../src/modules/scheduled/owner-pii-redact.job';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, freshEmail, staffAccount } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof identityServices>;
let applicant: AccountContext;
let moderator: AccountContext;

const NATIONAL_ID = '079201001234';
const DAY_MS = 24 * 60 * 60 * 1000;
const Status = identityGrpc.OwnerRegistrationStatus;

beforeEach(async () => {
  await truncateAll(prisma);
  services = identityServices(prisma);
  applicant = await person();
  moderator = (await staffAccount(prisma, ['CONTENT_MODERATOR'])).context;
});
afterAll(() => prisma.$disconnect());

async function person(
  data: {
    isEmailVerified?: boolean;
    ownerVerifiedAt?: Date;
    deletedAt?: Date;
    erasedAt?: Date;
  } = {},
): Promise<AccountContext> {
  const row = await prisma.user.create({
    data: { email: freshEmail(), isEmailVerified: true, ...data },
    select: { id: true },
  });
  return buildAccountContext({ userId: row.id });
}

function application(
  over: Partial<identityGrpc.SubmitRegistrationRequest> = {},
): identityGrpc.SubmitRegistrationRequest {
  return {
    businessName: 'Quán Bún Chả Hà Nội',
    businessAddress: '12 Lê Lợi, Quận 1',
    contactName: 'Nguyễn Văn An',
    contactPhone: '+84901234567',
    // Spaces are stripped before the 12 digits are checked.
    nationalId: '079 201 001 234',
    applicantNote: 'The stall at the corner.',
    ownerAgreementVersion: LEGAL_DOCUMENT_VERSIONS.OWNER_AGREEMENT,
    ...over,
  };
}

async function apply(context: AccountContext = applicant): Promise<string> {
  const { registration } = await services.registrations.submitRegistration(application(), context);
  return registration!.id;
}

async function events(subject: string): Promise<Record<string, unknown>[]> {
  const rows = await prisma.outboxEvent.findMany({ where: { subject }, orderBy: { id: 'asc' } });
  return rows.map((row) => row.payload as Record<string, unknown>);
}

async function audits(action: AuditAction): Promise<Record<string, unknown>[]> {
  return (await events(AUDIT_RECORD.subject)).filter((payload) => payload.action === action);
}

const approve = (id: string, context = moderator, notes: { decisionNote?: string } = {}) =>
  services.ownerReview.approveRegistration({ registrationId: id, ...notes }, context);

const reject = (id: string, decisionNote: string, context = moderator) =>
  services.ownerReview.rejectRegistration({ registrationId: id, decisionNote }, context);

describe('applying', () => {
  it('stores the application with the last four only, and records the agreement once', async () => {
    const { registration } = await services.registrations.submitRegistration(
      application(),
      applicant,
    );
    expect(registration).toMatchObject({
      status: Status.OWNER_REGISTRATION_STATUS_PENDING,
      businessName: 'Quán Bún Chả Hà Nội',
      nationalIdLast4: '1234',
    });
    expect(JSON.stringify(registration)).not.toContain(NATIONAL_ID);
    const acceptances = await prisma.legalAcceptance.findMany({
      where: { userId: applicant.userId, document: LegalDocument.OWNER_AGREEMENT },
    });
    expect(acceptances).toHaveLength(1);
    expect(await audits(AuditAction.OWNER_REGISTRATION_SUBMITTED)).toEqual([
      expect.objectContaining({ metadata: { after: { status: 'PENDING' } } }),
    ]);

    // Withdrawn and applied again: the acceptance is not written twice.
    await services.registrations.withdrawRegistration(
      { registrationId: registration!.id },
      applicant,
    );
    await apply();
    expect(
      await prisma.legalAcceptance.count({
        where: { userId: applicant.userId, document: LegalDocument.OWNER_AGREEMENT },
      }),
    ).toBe(1);
  });

  it('keeps the national ID out of the row, the outbox and the audit metadata', async () => {
    const id = await apply();
    const row = await prisma.ownerRegistration.findUniqueOrThrow({ where: { id } });
    expect(row.nationalIdCiphertext).toMatch(/^v1:/);
    const { nationalIdCiphertext: _ciphertext, ...rest } = row;
    expect(JSON.stringify(rest)).not.toContain(NATIONAL_ID);
    expect(row.nationalIdCiphertext).not.toContain(NATIONAL_ID);
    const outbox = await prisma.outboxEvent.findMany();
    expect(JSON.stringify(outbox.map((event) => event.payload))).not.toContain(NATIONAL_ID);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(NATIONAL_ID);
  });

  it('refuses a second open application, an unverified email, an owner and an old agreement', async () => {
    await apply();
    expect((await errorOf(apply())).code).toBe('REGISTRATION_ALREADY_PENDING');
    expect((await errorOf(apply(await person({ isEmailVerified: false })))).code).toBe(
      'EMAIL_NOT_VERIFIED',
    );
    expect(await errorOf(apply(await person({ ownerVerifiedAt: new Date() })))).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'ALREADY_OWNER' },
    });
    const outdated = await errorOf(
      services.registrations.submitRegistration(
        application({ ownerAgreementVersion: '2020-01-01' }),
        await person(),
      ),
    );
    expect(outdated).toEqual({
      code: 'LEGAL_VERSION_OUTDATED',
      details: {
        document: 'OWNER_AGREEMENT',
        currentVersion: LEGAL_DOCUMENT_VERSIONS.OWNER_AGREEMENT,
      },
    });
  });

  it('refuses a national ID that is not 12 digits, without echoing it', async () => {
    const refused = await errorOf(
      services.registrations.submitRegistration(
        application({ nationalId: '07920100123' }),
        await person(),
      ),
    );
    expect(refused.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(refused)).not.toContain('07920100123');
  });

  it('serializes two concurrent applications by one user: one wins, one conflicts', async () => {
    const results = await Promise.allSettled([apply(), apply()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect((await errorOf(Promise.reject(rejected!.reason as Error))).code).toBe(
      'REGISTRATION_ALREADY_PENDING',
    );
    expect(await prisma.ownerRegistration.count()).toBe(1);
    expect(await prisma.legalAcceptance.count({ where: { userId: applicant.userId } })).toBe(1);
  });
});

describe("the applicant's reads and withdrawal", () => {
  it('lists newest first, with no staff note key at all', async () => {
    const first = await apply();
    await reject(first, 'The address does not match.');
    await prisma.ownerRegistration.update({
      where: { id: first },
      data: { internalNote: 'Staff only: called the number.' },
    });
    const second = await apply();
    const { registrations } = await services.registrations.listMyRegistrations(applicant);
    expect(registrations.map((row) => row.id)).toEqual([second, first]);
    expect(registrations[1]).toMatchObject({ decisionNote: 'The address does not match.' });
    const serialized = JSON.stringify(registrations);
    expect(serialized).not.toContain('internalNote');
    expect(serialized).not.toContain('Staff only');
  });

  it('withdraws once; again is INVALID_STATE, and another user’s is not found', async () => {
    const id = await apply();
    const { registration } = await services.registrations.withdrawRegistration(
      { registrationId: id },
      applicant,
    );
    expect(registration!.status).toBe(Status.OWNER_REGISTRATION_STATUS_WITHDRAWN);
    expect(
      await errorOf(services.registrations.withdrawRegistration({ registrationId: id }, applicant)),
    ).toEqual({ code: 'INVALID_STATE', details: { status: 'WITHDRAWN' } });
    const other = await apply(await person());
    expect(
      (
        await errorOf(
          services.registrations.withdrawRegistration({ registrationId: other }, applicant),
        )
      ).code,
    ).toBe('RESOURCE_NOT_FOUND');
    expect(await audits(AuditAction.OWNER_REGISTRATION_WITHDRAWN)).toEqual([
      expect.objectContaining({ metadata: { before: { status: 'PENDING' } } }),
    ]);
  });

  it("puts the open application on GetMe's owner summary", async () => {
    expect((await services.users.getMe(applicant)).owner).toBeUndefined();
    const id = await apply();
    const me = await services.users.getMe(applicant);
    expect(me.owner?.pendingRegistration?.id).toBe(id);
    await approve(id);
    const after = await services.users.getMe(applicant);
    expect(after.ownerVerified).toBe(true);
    expect(after.owner).toEqual({ pendingRegistration: undefined });
  });
});

describe('the review queue', () => {
  it('lists PENDING oldest first, filters by status, and searches literally', async () => {
    const other = await person();
    const first = await apply();
    const second = await services.registrations.submitRegistration(
      application({ businessName: 'Cà Phê 100%', contactName: 'Trần Bình' }),
      other,
    );
    const list = (over: Partial<identityGrpc.ListRegistrationsRequest> = {}) =>
      services.ownerReview.listRegistrations(
        {
          page: { page: 1, pageSize: 20, sort: '' },
          status: Status.OWNER_REGISTRATION_STATUS_PENDING,
          ...over,
        },
        moderator,
      );
    const pending = await list();
    expect(pending.registrations.map((row) => row.registration!.id)).toEqual([
      first,
      second.registration!.id,
    ]);
    expect(pending.page).toEqual({ page: 1, pageSize: 20, total: 2 });
    const found = await list({ page: { page: 1, pageSize: 20, sort: '', q: '100%' } });
    expect(found.registrations.map((row) => row.registration!.id)).toEqual([
      second.registration!.id,
    ]);
    const byContact = await list({ page: { page: 1, pageSize: 20, sort: '', q: 'trần' } });
    expect(byContact.page!.total).toBe(1);
    const wildcard = await list({ page: { page: 1, pageSize: 20, sort: '', q: '_' } });
    expect(wildcard.page!.total).toBe(0);
    await reject(first, 'No.');
    const rejected = await list({ status: Status.OWNER_REGISTRATION_STATUS_REJECTED });
    expect(rejected.registrations.map((row) => row.registration!.id)).toEqual([first]);
  });

  it('shows the detail with the applicant and their earlier applications', async () => {
    const earlier = await apply();
    await reject(earlier, 'Missing documents.');
    const id = await apply();
    const { registration } = await services.ownerReview.getRegistration(
      { registrationId: id },
      moderator,
    );
    expect(registration).toMatchObject({
      registration: { id, nationalIdLast4: '1234' },
      piiRedacted: false,
      applicant: {
        id: applicant.userId,
        emailVerified: true,
        ownerVerified: false,
        isLocked: false,
        deactivated: false,
      },
      priorApplications: [{ id: earlier, status: Status.OWNER_REGISTRATION_STATUS_REJECTED }],
    });
    expect(JSON.stringify(registration)).not.toContain(NATIONAL_ID);
  });

  it('reveals the number with an audit row that does not hold it', async () => {
    const id = await apply();
    const admin = (await staffAccount(prisma, [SystemRole.ADMIN])).context;
    expect(await services.ownerReview.revealNationalId({ registrationId: id }, admin)).toEqual({
      nationalId: NATIONAL_ID,
    });
    await services.ownerReview.revealNationalId({ registrationId: id }, admin);
    const revealed = await audits(AuditAction.OWNER_NATIONAL_ID_REVEALED);
    expect(revealed).toHaveLength(2);
    expect(revealed[0]).toMatchObject({
      actor: { type: 'USER', userId: admin.userId },
      resource: { type: 'OWNER_REGISTRATION', id },
      metadata: {},
    });
    expect(JSON.stringify(revealed)).not.toContain(NATIONAL_ID);
  });
});

describe('approval', () => {
  it('verifies the owner, cuts their tokens, publishes, notifies and emails in one go', async () => {
    const id = await apply();
    const { registration } = await approve(id, moderator, { decisionNote: 'Welcome aboard.' });
    expect(registration).toMatchObject({
      registration: {
        status: Status.OWNER_REGISTRATION_STATUS_APPROVED,
        decisionNote: 'Welcome aboard.',
      },
      reviewedById: moderator.userId,
      applicant: { ownerVerified: true },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: applicant.userId },
      select: { ownerVerifiedAt: true, tokensValidAfter: true },
    });
    expect(user.ownerVerifiedAt).not.toBeNull();
    expect(user.tokensValidAfter).not.toBeNull();
    expect((await services.access.accessOf(prisma, applicant.userId)).roles).toContain(
      SystemRole.VENUE_OWNER,
    );
    expect(await events(IDENTITY_OWNER_VERIFIED.subject)).toEqual([
      expect.objectContaining({ userId: applicant.userId }),
    ]);
    expect(await events(IDENTITY_SESSION_REVOKED.subject)).toEqual([
      expect.objectContaining({ userId: applicant.userId, reason: 'PERMISSIONS_CHANGED' }),
    ]);
    const [audited] = await audits(AuditAction.OWNER_REGISTRATION_APPROVED);
    expect(audited).toMatchObject({
      metadata: { after: { status: 'APPROVED', hasDecisionNote: true, hasInternalNote: false } },
    });
    expect(JSON.stringify(audited)).not.toContain('Welcome aboard');

    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientUserId: applicant.userId },
    });
    expect(notification).toMatchObject({
      type: NotificationType.OWNER_REGISTRATION_APPROVED,
      data: { registrationId: id, decisionNote: 'Welcome aboard.' },
      eventId: audited!.eventId,
    });
    expect(services.frames.of('notificationNew')).toHaveLength(1);

    await services.dispatcher.idle();
    expect(services.mailbox.sent).toHaveLength(1);
    expect(services.mailbox.sent[0]!.text).toContain('http://console.localhost/owner/registration');
  });

  it('refuses a second decision, a reviewer’s own application and a deactivated applicant', async () => {
    const id = await apply();
    await approve(id);
    expect(await errorOf(approve(id))).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'APPROVED' },
    });

    const reviewer = await staffAccount(prisma, ['CONTENT_MODERATOR'], {
      email: freshEmail(),
    });
    await prisma.user.update({ where: { id: reviewer.id }, data: { isEmailVerified: true } });
    const own = await apply(reviewer.context);
    expect((await errorOf(approve(own, reviewer.context))).code).toBe('PERMISSION_DENIED');
    expect((await errorOf(reject(own, 'No.', reviewer.context))).code).toBe('PERMISSION_DENIED');

    const leaving = await person();
    const stale = await apply(leaving);
    await prisma.user.update({ where: { id: leaving.userId }, data: { deletedAt: new Date() } });
    expect(await errorOf(approve(stale))).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'DEACTIVATED' },
    });
    expect(
      (await prisma.ownerRegistration.findUniqueOrThrow({ where: { id: stale } })).status,
    ).toBe(OwnerRegistrationStatus.PENDING);
  });

  it('lets one of two concurrent reviews win', async () => {
    const id = await apply();
    const results = await Promise.allSettled([approve(id), reject(id, 'Duplicate.')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect((await errorOf(Promise.reject(lost!.reason as Error))).code).toBe('INVALID_STATE');
    expect(await prisma.notification.count()).toBe(1);
  });
});

describe('rejection', () => {
  it('requires a decision note, tells the applicant, and allows a new application', async () => {
    const id = await apply();
    expect(
      (
        await errorOf(
          services.ownerReview.rejectRegistration(
            { registrationId: id, decisionNote: '   ' },
            moderator,
          ),
        )
      ).code,
    ).toBe('VALIDATION_FAILED');
    await services.ownerReview.rejectRegistration(
      { registrationId: id, decisionNote: 'Photo unreadable.', internalNote: 'Looked edited.' },
      moderator,
    );
    const [audited] = await audits(AuditAction.OWNER_REGISTRATION_REJECTED);
    expect(audited).toMatchObject({
      metadata: { after: { status: 'REJECTED', hasDecisionNote: true, hasInternalNote: true } },
    });
    expect(
      await prisma.notification.findFirstOrThrow({ where: { recipientUserId: applicant.userId } }),
    ).toMatchObject({
      type: NotificationType.OWNER_REGISTRATION_REJECTED,
      data: { registrationId: id, decisionNote: 'Photo unreadable.' },
    });
    await services.dispatcher.idle();
    // A plain user's links open the web app, but this page lives in the console.
    expect(services.mailbox.sent[0]!.text).toContain('http://console.localhost/owner/registration');
    expect(services.mailbox.sent[0]!.text).not.toContain('Looked edited');
    expect(await events(IDENTITY_OWNER_VERIFIED.subject)).toEqual([]);
    await apply();
  });
});

describe('owner-pii-redact', () => {
  async function decided(status: OwnerRegistrationStatus, clock: Date): Promise<string> {
    const id = await apply(await person());
    if (status === OwnerRegistrationStatus.WITHDRAWN) {
      await prisma.$executeRaw`
        UPDATE owner_registrations SET status = 'WITHDRAWN', updated_at = ${clock}
        WHERE id = ${id}::uuid`;
    } else if (status !== OwnerRegistrationStatus.PENDING) {
      await prisma.$executeRaw`
        UPDATE owner_registrations SET status = ${status}, reviewed_at = ${clock}
        WHERE id = ${id}::uuid`;
    } else {
      await prisma.$executeRaw`
        UPDATE owner_registrations SET submitted_at = ${clock}, updated_at = ${clock}
        WHERE id = ${id}::uuid`;
    }
    return id;
  }

  it('redacts rows past the retention period, at the edge and not before', async () => {
    const now = new Date('2027-06-01T00:00:00.000Z');
    const edge = new Date(now.getTime() - PII_RETENTION_DAYS * DAY_MS);
    const justInside = new Date(edge.getTime() + 1);
    const due = [
      await decided(OwnerRegistrationStatus.APPROVED, edge),
      await decided(OwnerRegistrationStatus.REJECTED, new Date(edge.getTime() - DAY_MS)),
      await decided(OwnerRegistrationStatus.WITHDRAWN, edge),
    ];
    const kept = [
      await decided(OwnerRegistrationStatus.APPROVED, justInside),
      await decided(OwnerRegistrationStatus.WITHDRAWN, justInside),
      await decided(OwnerRegistrationStatus.PENDING, new Date(edge.getTime() - 400 * DAY_MS)),
    ];

    const job = new OwnerPiiRedactJob(prisma, new OutboxService());
    const result = await new JobRunRecorder(prisma).track(job.name, () => job.run(now));
    expect(result).toEqual({ redacted: 3 });
    for (const id of due) {
      expect(await prisma.ownerRegistration.findUniqueOrThrow({ where: { id } })).toMatchObject({
        nationalIdCiphertext: null,
        nationalIdLast4: null,
        piiRedactedAt: now,
      });
    }
    for (const id of kept) {
      expect(
        (await prisma.ownerRegistration.findUniqueOrThrow({ where: { id } })).piiRedactedAt,
      ).toBeNull();
    }
    const redacted = await audits(AuditAction.OWNER_PII_REDACTED);
    expect(
      redacted.map((payload) => (payload.resource as { id: string }).id).toSorted(compareStrings),
    ).toEqual(due.toSorted(compareStrings));
    expect(redacted[0]).toMatchObject({ actor: { type: 'SYSTEM' }, metadata: {} });
    expect(
      await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'owner-pii-redact' } }),
    ).toMatchObject({ consecutiveFailures: 0 });

    // A second run finds nothing; the reveal answers 410.
    expect(await job.run(now)).toEqual({ redacted: 0 });
    const admin = (await staffAccount(prisma, [SystemRole.ADMIN])).context;
    expect(
      (await errorOf(services.ownerReview.revealNationalId({ registrationId: due[0]! }, admin)))
        .code,
    ).toBe('NATIONAL_ID_REDACTED');
    const { registration } = await services.ownerReview.getRegistration(
      { registrationId: due[0]! },
      moderator,
    );
    expect(registration).toMatchObject({ piiRedacted: true });
    expect(registration!.registration!.nationalIdLast4).toBeUndefined();
  });
});

describe('erasure', () => {
  it('withdraws the open application and clears every row, with one audit row each', async () => {
    const earlier = await apply();
    await reject(earlier, 'Try again.');
    const open = await apply();
    const other = await apply(await person());
    const now = new Date();

    const result = await prisma.$transaction((tx) =>
      services.registrations.eraseFor(tx, applicant.userId, now),
    );
    expect(result).toEqual({ withdrawn: 1, cleared: 2 });
    for (const id of [earlier, open]) {
      expect(await prisma.ownerRegistration.findUniqueOrThrow({ where: { id } })).toMatchObject({
        nationalIdCiphertext: null,
        nationalIdLast4: null,
        contactName: '',
        contactPhone: '',
        piiRedactedAt: now,
      });
    }
    expect((await prisma.ownerRegistration.findUniqueOrThrow({ where: { id: open } })).status).toBe(
      OwnerRegistrationStatus.WITHDRAWN,
    );
    expect(
      (await prisma.ownerRegistration.findUniqueOrThrow({ where: { id: other } }))
        .nationalIdCiphertext,
    ).toMatch(/^v1:/);
    const redacted = await audits(AuditAction.OWNER_PII_REDACTED);
    expect(
      redacted.map((payload) => (payload.resource as { id: string }).id).toSorted(compareStrings),
    ).toEqual([earlier, open].toSorted(compareStrings));
  });
});

describe('listVerifiedOwnerIds', () => {
  it('answers live, verified owners only — never an unverified, deactivated or erased one', async () => {
    const now = new Date();
    const verified = await person({ ownerVerifiedAt: now });
    await person(); // never applied
    await person({ ownerVerifiedAt: now, deletedAt: now }); // deactivated
    await person({ ownerVerifiedAt: now, deletedAt: now, erasedAt: now }); // erased

    const answer = await services.registrations.listVerifiedOwnerIds({ page: { limit: 20 } });
    expect(answer.ownerUserIds).toEqual([verified.userId]);
    expect(answer.page).toEqual({});
  });

  it('pages keyset on the id, oldest first, with an opaque cursor', async () => {
    const now = new Date();
    const owners = [
      await person({ ownerVerifiedAt: now }),
      await person({ ownerVerifiedAt: now }),
      await person({ ownerVerifiedAt: now }),
    ];
    const sorted = owners.map((o) => o.userId).toSorted(compareStrings);

    const first = await services.registrations.listVerifiedOwnerIds({ page: { limit: 2 } });
    expect(first.ownerUserIds).toEqual(sorted.slice(0, 2));
    expect(first.page?.nextCursor).toBeTruthy();

    const second = await services.registrations.listVerifiedOwnerIds({
      page: { limit: 2, cursor: first.page?.nextCursor },
    });
    expect(second.ownerUserIds).toEqual(sorted.slice(2));
    expect(second.page).toEqual({});
  });
});
