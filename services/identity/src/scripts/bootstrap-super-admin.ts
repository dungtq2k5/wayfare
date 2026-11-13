// pnpm --filter @wayfare/identity bootstrap:super-admin — creates the first SUPER_ADMIN, or grants
// the role to an existing live account (rdm-spec I-4). Reads BOOTSTRAP_SUPER_ADMIN_EMAIL and
// BOOTSTRAP_SUPER_ADMIN_PASSWORD; the running service never does. Idempotent; never overwrites a
// password. Runs from the build output, so the package script builds first.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  compareStrings,
  SystemRole,
  zEmail,
} from '@wayfare/contracts';
import { OutboxService } from '@wayfare/nest-common';
import { z } from 'zod';
import { PrismaClient } from '../../generated/prisma/client';
import { AccessService } from '../modules/access/access.service';
import { auditRecord } from '../modules/audit/domain/audit-record';
import type { AuditFacts } from '../modules/audit/domain/audit-record';
import { bumpTokenCutoff } from '../modules/sessions/sessions.service';
import { syncSystemCatalog } from '../modules/system-catalog/system-catalog.service';
import { hashPassword, isPasswordTheEmail, zNewPassword } from '../modules/tokens/domain/password';

/** The script's input, validated like a registration. */
export const bootstrapInput = z
  .object({
    BOOTSTRAP_SUPER_ADMIN_EMAIL: zEmail,
    BOOTSTRAP_SUPER_ADMIN_PASSWORD: zNewPassword,
  })
  .refine(
    (input) =>
      !isPasswordTheEmail(input.BOOTSTRAP_SUPER_ADMIN_PASSWORD, input.BOOTSTRAP_SUPER_ADMIN_EMAIL),
    { path: ['BOOTSTRAP_SUPER_ADMIN_PASSWORD'], message: 'must not be the email address' },
  )
  .transform((input) => ({
    email: input.BOOTSTRAP_SUPER_ADMIN_EMAIL,
    password: input.BOOTSTRAP_SUPER_ADMIN_PASSWORD,
  }));

/** What one run did. */
export interface BootstrapOutcome {
  readonly userId: string;
  readonly created: boolean;
  readonly granted: boolean;
  readonly passwordSet: boolean;
}

/** A refusal the operator must resolve by hand; the script exits 1 with its message. */
export class BootstrapRefused extends Error {}

const SYSTEM_ACTOR = { type: AuditActorType.SYSTEM } as const;
const NO_ORIGIN = { ip: null, userAgent: null } as const;

/**
 * Makes `email` an active `SUPER_ADMIN`, in one transaction after the catalogue sync:
 *
 * - no account → created with the password, verified, and granted the role;
 * - a live account → granted the role if missing (its cutoff bumped), and given the password only
 *   when it has none — a staff account created without one;
 * - a deactivated or erased account → refused: restoring is an admin action with a reason.
 */
export async function bootstrapSuperAdmin(
  prisma: PrismaClient,
  input: { readonly email: string; readonly password: string },
  now: Date = new Date(),
): Promise<BootstrapOutcome> {
  await syncSystemCatalog(prisma);
  const outbox = new OutboxService();
  const access = new AccessService();
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true, deletedAt: true },
  });
  if (existing !== null && existing.deletedAt !== null) {
    throw new BootstrapRefused(
      `${input.email} belongs to a deactivated or erased account — restore it from the console first`,
    );
  }
  // Hashed outside the transaction: argon2 is deliberately slow.
  const passwordHash =
    existing === null || existing.passwordHash === null ? await hashPassword(input.password) : null;

  return prisma.$transaction(async (tx) => {
    const audit = (action: AuditAction, userId: string, metadata: AuditFacts['metadata']) =>
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

    if (existing === null) {
      const user = await tx.user.create({
        data: { email: input.email, passwordHash, isEmailVerified: true, fullName: null },
        select: { id: true },
      });
      await access.assignRole(tx, user.id, SystemRole.SUPER_ADMIN);
      await audit(AuditAction.STAFF_USER_CREATED, user.id, {
        after: { roleCodes: [SystemRole.SUPER_ADMIN] },
      });
      await audit(AuditAction.USER_ROLES_UPDATED, user.id, {
        before: { roleCodes: [] },
        after: { roleCodes: [SystemRole.SUPER_ADMIN] },
      });
      return { userId: user.id, created: true, granted: true, passwordSet: true };
    }

    const before = (await access.accessOf(tx, existing.id)).roles;
    const granted = !before.includes(SystemRole.SUPER_ADMIN);
    if (granted) {
      await access.assignRole(tx, existing.id, SystemRole.SUPER_ADMIN);
      await bumpTokenCutoff(tx, outbox, [existing.id], now);
      await audit(AuditAction.USER_ROLES_UPDATED, existing.id, {
        before: { roleCodes: before },
        after: { roleCodes: [...before, SystemRole.SUPER_ADMIN].toSorted(compareStrings) },
      });
    }
    if (passwordHash !== null) {
      await tx.user.update({
        where: { id: existing.id },
        data: { passwordHash, isEmailVerified: true },
        select: { id: true },
      });
    }
    return {
      userId: existing.id,
      created: false,
      granted,
      passwordSet: passwordHash !== null,
    };
  });
}

/** One line per thing that happened; never the password. */
export function describeOutcome(email: string, outcome: BootstrapOutcome): string {
  if (outcome.created) return `✓ created ${email} as SUPER_ADMIN`;
  const done = [
    ...(outcome.granted ? ['granted SUPER_ADMIN'] : []),
    ...(outcome.passwordSet ? ['password set'] : []),
  ];
  return done.length === 0
    ? `✓ ${email} is already SUPER_ADMIN — nothing to do`
    : `✓ ${email}: ${done.join(', ')}`;
}

async function main(): Promise<void> {
  const parsed = bootstrapInput.safeParse({
    BOOTSTRAP_SUPER_ADMIN_EMAIL: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL,
    BOOTSTRAP_SUPER_ADMIN_PASSWORD: process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD,
  });
  if (!parsed.success) {
    const fields = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new BootstrapRefused(`Invalid bootstrap input:\n${fields.join('\n')}`);
  }
  const url =
    process.env.PRISMA_DB === 'test' ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new BootstrapRefused('No database URL — copy .env.example to .env');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const outcome = await bootstrapSuperAdmin(prisma, parsed.data);
    console.log(describeOutcome(parsed.data.email, outcome));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof BootstrapRefused ? error.message : error);
    process.exit(1);
  });
}
