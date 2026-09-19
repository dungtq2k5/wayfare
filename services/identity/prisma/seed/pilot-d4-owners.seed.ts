// pnpm seed:dev — the Vĩnh Khánh owners (ADR 0001, ADR 0002): obviously fake owners who applied and
// were approved through identity's own services, with the seed editor as the reviewer, and one
// applicant left pending. Approval publishes `identity.owner.verified`, so the running billing opens
// each account the ordinary way. Run it through turbo only, after `dev-accounts` (the seed editor).
// Never in production; idempotent; never overwrites a password, never deletes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
  newId,
  SystemRole,
  zUuidV7,
} from '@wayfare/contracts';
import { SEED_EDITOR_USER_ID } from '@wayfare/contracts/testing';
import { OutboxService, packageRoot, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { config } from 'dotenv';
import { z } from 'zod';
import { AppModule } from '../../src/app.module';
import { AccessService } from '../../src/modules/access/access.service';
import { auditRecord } from '../../src/modules/audit/domain/audit-record';
import { EmailDispatcher } from '../../src/modules/email/email.module';
import { LegalService } from '../../src/modules/legal/legal.service';
import { OwnerRegistrationsService } from '../../src/modules/owner-registrations/owner-registrations.service';
import { OwnerReviewService } from '../../src/modules/owner-review/owner-review.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { hashPassword, zNewPassword } from '../../src/modules/tokens/domain/password';

/** One committed owner or applicant (ADR 0002): fictional, and saying so. */
export const zPilotOwner = z
  .object({
    slug: z.string().regex(/^(owner|applicant)-\d+$/),
    id: zUuidV7,
    email: z.email().endsWith('@wayfare.test'),
    fullName: z.string().min(1).max(120),
    registration: z
      .object({
        id: zUuidV7,
        status: z.enum(['APPROVED', 'PENDING']),
        businessName: z.string().min(1),
        businessAddress: z.string().min(1),
        contactName: z.string().min(1),
        contactPhone: z.string().min(1),
        nationalId: z.string().regex(/^000\d{9}$/),
      })
      .strict(),
  })
  .strict();
/** One committed owner. */
export type PilotOwner = z.output<typeof zPilotOwner>;

/** The committed owners, read by all three seeds (identity's package holds them). */
export const PILOT_D4_OWNERS_FILE = resolve(
  packageRoot(__dirname),
  'prisma/seed/pilot-d4/owners.json',
);

/** Reads and validates the owners; throws naming the first bad entry. */
export function loadPilotOwners(file: string = PILOT_D4_OWNERS_FILE): PilotOwner[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { owners: unknown[] };
  return raw.owners.map((owner, index) => {
    const parsed = zPilotOwner.safeParse(owner);
    if (!parsed.success) throw new Error(`owners.json[${index}]: ${parsed.error.message}`);
    return parsed.data;
  });
}

/** Refuses a production environment: these owners are fictional (ADR 0002). */
export function assertNotProduction(env: Readonly<Record<string, string | undefined>>): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production (ADR 0002)');
  }
}

/** The seed editor, as identity's review sees the reviewer. */
export const SEED_REVIEWER: AccountContext = {
  kind: 'account',
  userId: SEED_EDITOR_USER_ID,
  sessionId: newId(),
  deviceId: null,
  permissions: [],
  ownerVerified: false,
  emailVerified: true,
  origin: SYSTEM_ORIGIN,
};

/** An owner acting for themselves, as the registration route would see them. */
const asOwner = (owner: PilotOwner): AccountContext => ({
  kind: 'account',
  userId: owner.id,
  sessionId: newId(),
  deviceId: null,
  permissions: [],
  ownerVerified: false,
  emailVerified: true,
  origin: SYSTEM_ORIGIN,
});

/** What the owners seed calls. */
export interface OwnersSeedDeps {
  readonly prisma: PrismaService;
  readonly registrations: Pick<OwnerRegistrationsService, 'submitRegistration'>;
  readonly review: Pick<OwnerReviewService, 'approveRegistration'>;
  readonly legal: Pick<LegalService, 'acceptIfMissing'>;
  readonly access: Pick<AccessService, 'assignRole'>;
}

/**
 * Creates what is missing; changes nothing that exists (a registration in any status is left as
 * it is). Without a password the owners are created unable to sign in. Returns the report lines.
 */
export async function seedPilotD4Owners(
  deps: OwnersSeedDeps,
  owners: readonly PilotOwner[],
  input: { readonly password: string | null },
): Promise<string[]> {
  const lines: string[] = [];
  const outbox = new OutboxService();
  for (const owner of owners) {
    const existing = await deps.prisma.user.findUnique({
      where: { id: owner.id },
      select: { id: true },
    });
    if (existing === null) {
      // Hashed outside the transaction: argon2 is deliberately slow.
      const passwordHash = input.password === null ? null : await hashPassword(input.password);
      const now = new Date();
      await deps.prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: owner.id,
            email: owner.email,
            fullName: owner.fullName,
            passwordHash,
            isEmailVerified: true,
            preferredLocale: 'vi',
            createdAt: now,
          },
          select: { id: true },
        });
        await deps.access.assignRole(tx, owner.id, SystemRole.USER);
        await deps.legal.acceptIfMissing(
          tx,
          owner.id,
          LegalDocument.TERMS_OF_SERVICE,
          LEGAL_DOCUMENT_VERSIONS[LegalDocument.TERMS_OF_SERVICE],
          null,
        );
        await outbox.add(
          tx,
          AUDIT_RECORD,
          auditRecord({
            actor: { type: AuditActorType.SYSTEM },
            action: AuditAction.USER_REGISTERED,
            resource: { type: AuditResourceType.USER, id: owner.id },
            metadata: { after: { preferredLocale: 'vi', client: 'seed' } },
            origin: { ip: null, userAgent: null },
            now,
          }),
        );
      });
      lines.push(
        `created ${owner.email}${input.password === null ? ' (no password: SEED_ACCOUNT_PASSWORD is unset)' : ''}`,
      );
    } else {
      lines.push(`unchanged ${owner.email}`);
    }

    const registration = await deps.prisma.ownerRegistration.findUnique({
      where: { id: owner.registration.id },
      select: { status: true },
    });
    let status = registration?.status;
    if (registration === null) {
      await deps.registrations.submitRegistration(
        {
          businessName: owner.registration.businessName,
          businessAddress: owner.registration.businessAddress,
          contactName: owner.registration.contactName,
          contactPhone: owner.registration.contactPhone,
          nationalId: owner.registration.nationalId,
          ownerAgreementVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.OWNER_AGREEMENT],
        },
        asOwner(owner),
        { id: owner.registration.id },
      );
      status = 'PENDING';
      lines.push(`submitted ${owner.slug}'s application`);
    }
    if (owner.registration.status === 'APPROVED' && status === 'PENDING') {
      await deps.review.approveRegistration(
        { registrationId: owner.registration.id },
        SEED_REVIEWER,
      );
      lines.push(`approved ${owner.slug}'s application`);
    } else if (registration !== null) {
      lines.push(`unchanged ${owner.slug}'s application (${status})`);
    }
  }
  return lines;
}

async function main(): Promise<void> {
  assertNotProduction(process.env);
  config({ path: resolve(packageRoot(__dirname), '.env'), quiet: true });
  if (process.env.PRISMA_DB === 'test') process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const raw = process.env.SEED_ACCOUNT_PASSWORD;
  const password = raw === undefined || raw === '' ? null : zNewPassword.parse(raw);
  const owners = loadPilotOwners();
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ jobs: false }), {
    logger: ['error', 'warn'],
  });
  try {
    const lines = await seedPilotD4Owners(
      {
        prisma: app.get(PrismaService),
        registrations: app.get(OwnerRegistrationsService),
        review: app.get(OwnerReviewService),
        legal: app.get(LegalService),
        access: app.get(AccessService),
      },
      owners,
      { password },
    );
    // The approval mails are sent after each commit; let them finish before the context closes.
    await app.get(EmailDispatcher).idle();
    for (const line of lines) console.log(`✓ ${line}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
