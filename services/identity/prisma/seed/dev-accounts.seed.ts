// pnpm seed:dev — identity's development accounts (ADR 0002, conventions §8.1). Run it through turbo
// only (`pnpm seed:dev`, optionally `--filter`): catalog's seed depends on the seed editor it makes.
// Never in production; idempotent; never overwrites a password, never deletes.
//
// - the seed editor ("Wayfare seed"): owns every seeded catalog row; deactivated, no password, no
//   role, so neither sign-in nor a password reset reaches it;
// - moderator@wayfare.test (USER, CONTENT_MODERATOR) and tourist@wayfare.test (USER), verified,
//   only when SEED_ACCOUNT_PASSWORD is set.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  SystemRole,
} from '@wayfare/contracts';
import { SEED_EDITOR_EMAIL, SEED_EDITOR_USER_ID } from '@wayfare/contracts/testing';
import { OutboxService } from '@wayfare/nest-common';
import { PrismaClient } from '../../generated/prisma/client';
import { AccessService } from '../../src/modules/access/access.service';
import { auditRecord } from '../../src/modules/audit/domain/audit-record';
import type { AuditFacts } from '../../src/modules/audit/domain/audit-record';
import { syncSystemCatalog } from '../../src/modules/system-catalog/system-catalog.service';
import { hashPassword, zNewPassword } from '../../src/modules/tokens/domain/password';

/** The development accounts, with the roles a real one of each kind holds. */
export const DEV_ACCOUNTS = [
  { email: 'moderator@wayfare.test', roles: [SystemRole.USER, 'CONTENT_MODERATOR'] },
  { email: 'tourist@wayfare.test', roles: [SystemRole.USER] },
] as const;

/** One report line per account. */
export type SeedLine = string;

const SYSTEM_ACTOR = { type: AuditActorType.SYSTEM } as const;
const NO_ORIGIN = { ip: null, userAgent: null } as const;

/** Creates what is missing; changes nothing that exists. Returns the report lines. */
export async function seedDevAccounts(
  prisma: PrismaClient,
  input: { readonly password: string | null },
  now: Date = new Date(),
): Promise<SeedLine[]> {
  await syncSystemCatalog(prisma);
  const outbox = new OutboxService();
  const access = new AccessService();
  const lines: SeedLine[] = [];
  const audit = (
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    action: AuditAction,
    userId: string,
    metadata: AuditFacts['metadata'],
  ) =>
    outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: SYSTEM_ACTOR,
        action,
        resource: { type: AuditResourceType.USER, id: userId },
        metadata,
        origin: NO_ORIGIN,
        now,
      }),
    );

  const editor = await prisma.user.findUnique({
    where: { id: SEED_EDITOR_USER_ID },
    select: { id: true },
  });
  if (editor === null) {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: SEED_EDITOR_USER_ID,
          email: SEED_EDITOR_EMAIL,
          fullName: 'Wayfare seed',
          passwordHash: null,
          isEmailVerified: true,
          // Deactivated from the start: no sign-in, no password reset (rdm-spec I-1).
          createdAt: now,
          deletedAt: now,
        },
        select: { id: true },
      });
      await audit(tx, AuditAction.STAFF_USER_CREATED, SEED_EDITOR_USER_ID, {
        after: { roleCodes: [] },
      });
    });
    lines.push(`created ${SEED_EDITOR_EMAIL} (the seed editor, deactivated)`);
  } else {
    lines.push(`unchanged ${SEED_EDITOR_EMAIL}`);
  }

  if (input.password === null) {
    for (const account of DEV_ACCOUNTS)
      lines.push(`skipped ${account.email} (SEED_ACCOUNT_PASSWORD is unset)`);
    return lines;
  }
  for (const account of DEV_ACCOUNTS) {
    const existing = await prisma.user.findUnique({
      where: { email: account.email },
      select: { id: true },
    });
    if (existing !== null) {
      lines.push(`unchanged ${account.email}`);
      continue;
    }
    // Hashed outside the transaction: argon2 is deliberately slow.
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: account.email, passwordHash, isEmailVerified: true, fullName: null },
        select: { id: true },
      });
      for (const role of account.roles) await access.assignRole(tx, user.id, role);
      const roleCodes = [...account.roles];
      await audit(tx, AuditAction.STAFF_USER_CREATED, user.id, { after: { roleCodes } });
      await audit(tx, AuditAction.USER_ROLES_UPDATED, user.id, {
        before: { roleCodes: [] },
        after: { roleCodes },
      });
    });
    lines.push(`created ${account.email} (${account.roles.join(', ')})`);
  }
  return lines;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production (ADR 0002)');
  }
  const raw = process.env.SEED_ACCOUNT_PASSWORD;
  const password = raw === undefined || raw === '' ? null : zNewPassword.parse(raw);
  const url =
    process.env.PRISMA_DB === 'test' ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL — copy .env.example to .env');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    for (const line of await seedDevAccounts(prisma, { password })) console.log(`✓ ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
