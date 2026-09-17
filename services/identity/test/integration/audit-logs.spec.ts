import { AUDIT_ACTIONS, compareStrings, newId, SystemRole } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/modules/audit/audit.service';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, staffAccount } from '../setup/fixtures';

const prisma = testPrisma();
const audit = new AuditService(prisma);

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

const HOUR = 3_600_000;
const now = Date.now();
const window = {
  from: toProtoTimestamp(new Date(now - 24 * HOUR)),
  to: toProtoTimestamp(new Date(now + HOUR)),
};

async function row(
  occurredAt: Date,
  data: { action?: string; actorUserId?: string; resourceType?: string; resourceId?: string } = {},
) {
  const id = newId();
  await prisma.auditLog.create({
    data: {
      id,
      eventId: newId(),
      occurredAt,
      service: 'identity',
      actorType: data.actorUserId === undefined ? 'SYSTEM' : 'USER',
      actorUserId: data.actorUserId ?? null,
      action: data.action ?? 'USER_LOCKED',
      resourceType: data.resourceType ?? 'USER',
      resourceId: data.resourceId ?? null,
      metadata: { reason: 'r' },
    },
  });
  return id;
}

async function list(
  context: Awaited<ReturnType<typeof staffAccount>>['context'],
  overrides: Partial<identityGrpc.ListAuditLogsRequest> = {},
) {
  return audit.listAuditLogs(
    { page: { limit: 20, cursor: undefined }, ...window, ...overrides },
    context,
  );
}

describe('ListAuditLogs', () => {
  it('orders by the producer clock, then id — a late-arriving row sorts where it happened', async () => {
    const { context } = await staffAccount(prisma, [SystemRole.SUPER_ADMIN]);
    const newer = await row(new Date(now - HOUR));
    const late = await row(new Date(now - 2 * HOUR)); // a larger id, an older instant
    const tieA = await row(new Date(now - 3 * HOUR));
    const tieB = await row(new Date(now - 3 * HOUR));
    const { entries, page } = await list(context);
    expect(entries.map((entry) => entry.id)).toEqual([newer, late, tieB, tieA]);
    expect(page?.nextCursor).toBeUndefined();
    expect(entries[0]).toMatchObject({
      service: 'identity',
      actor: { type: 'SYSTEM' },
      action: 'USER_LOCKED',
      resource: { type: 'USER' },
      metadataJson: '{"reason":"r"}',
    });
  });

  it('pages by keyset without gaps or repeats, across equal instants', async () => {
    const { context } = await staffAccount(prisma, [SystemRole.SUPER_ADMIN]);
    const ids: string[] = [];
    for (let index = 0; index < 7; index++) {
      ids.push(await row(new Date(now - Math.floor(index / 2) * HOUR)));
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await list(context, { page: { limit: 3, cursor } });
      seen.push(...response.entries.map((entry) => entry.id));
      cursor = response.page?.nextCursor;
    } while (cursor !== undefined);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    const expected = await prisma.auditLog.findMany({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    expect(seen).toEqual(expected.map((entry) => entry.id));
  });

  it('filters by actor, action, and resource', async () => {
    const actor = await staffAccount(prisma, [SystemRole.SUPER_ADMIN]);
    const resourceId = newId();
    const mine = await row(new Date(now - HOUR), { actorUserId: actor.id });
    const retired = await row(new Date(now - HOUR), { action: 'SOMETHING_RETIRED' });
    const aboutRole = await row(new Date(now - HOUR), {
      action: 'ROLE_CREATED',
      resourceType: 'ROLE',
      resourceId,
    });
    await row(new Date(now - 48 * HOUR)); // outside the window
    const ids = async (overrides: Partial<identityGrpc.ListAuditLogsRequest>) =>
      (await list(actor.context, overrides)).entries.map((entry) => entry.id);
    expect(await ids({ actorUserId: actor.id })).toEqual([mine]);
    expect(await ids({ action: 'SOMETHING_RETIRED' })).toEqual([retired]);
    expect(await ids({ resourceType: 'ROLE', resourceId })).toEqual([aboutRole]);
    expect(await ids({})).toHaveLength(3);
  });

  it('refuses a missing, inverted or over-long window, and a malformed cursor', async () => {
    const { context } = await staffAccount(prisma, [SystemRole.SUPER_ADMIN]);
    const failure = async (overrides: Partial<identityGrpc.ListAuditLogsRequest>) =>
      (await errorOf(list(context, overrides))).code;
    const at = (ms: number) => toProtoTimestamp(new Date(ms));
    expect(await failure({ from: undefined })).toBe('VALIDATION_FAILED');
    expect(await failure({ from: at(now), to: at(now - HOUR) })).toBe('VALIDATION_FAILED');
    expect(await failure({ from: at(now - 94 * 24 * HOUR), to: at(now) })).toBe(
      'VALIDATION_FAILED',
    );
    expect(await failure({ page: { limit: 20, cursor: 'garbage' } })).toBe('VALIDATION_FAILED');
    expect(await failure({ action: 'lower_case' })).toBe('VALIDATION_FAILED');
    const exact = await list(context, { from: at(now - 93 * 24 * HOUR), to: at(now) });
    expect(exact.entries).toEqual([]);
  });

  it('the unfiltered query can use the (occurred_at, id) index', async () => {
    await prisma.$executeRaw`
      INSERT INTO audit_logs (id, event_id, occurred_at, service, actor_type, action, resource_type)
      SELECT gen_random_uuid(), gen_random_uuid(), now() - (i || ' seconds')::interval,
             'identity', 'SYSTEM', 'USER_LOCKED', 'USER'
      FROM generate_series(1, 10000) AS i`;
    await prisma.$executeRaw`ANALYZE audit_logs`;
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT id FROM audit_logs
        WHERE occurred_at >= ${new Date(now - 24 * HOUR)} AND occurred_at <= ${new Date(now)}
        ORDER BY occurred_at DESC, id DESC
        LIMIT 21`;
    });
    const text = plan.map((line) => line['QUERY PLAN']).join('\n');
    expect(text).toContain('audit_logs_occurred_at_id_idx');
  });
});

describe('ListAuditActions', () => {
  it('returns the vocabulary, sorted', async () => {
    const { context } = await staffAccount(prisma, [SystemRole.SUPER_ADMIN]);
    const { actions } = audit.listAuditActions(context);
    expect(actions).toEqual([...AUDIT_ACTIONS].toSorted(compareStrings));
  });
});
