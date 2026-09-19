// pnpm seed:dev — the Vĩnh Khánh owners' plans (ADR 0002): each owner the corpus puts on a paid plan
// gets a synthetic subscription, as billing's own webhook processing would apply a real one.
// Nothing is created in Stripe: the events carry fixed `evt_seed_` / `cus_seed_` / `sub_seed_` ids,
// so a second run meets their unique event ids and does nothing. Run it through turbo only, after
// identity's seed (the owners) and `dev-plans` (the prices). Never in production, never live.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { BillingEventStatus, FREE_PLAN_CODE, StripeEndpoint, zUuidV7 } from '@wayfare/contracts';
import { packageRoot } from '@wayfare/nest-common';
import { config } from 'dotenv';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { WebhooksService } from '../../src/modules/webhooks/webhooks.service';
import { assertNotProduction } from './dev-plans.seed';

const REPO_ROOT = resolve(packageRoot(__dirname), '../..');

/** Which owner is on which plan. */
export const zPilotPlan = z
  .object({
    ownerSlug: z.string().regex(/^owner-\d+$/),
    ownerUserId: zUuidV7,
    planCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  })
  .strict();
/** One owner's plan. */
export type PilotPlan = z.output<typeof zPilotPlan>;

/** The committed plans, checked against identity's owners so the ids cannot drift. */
export function loadPilotPlans(
  plansFile: string = resolve(packageRoot(__dirname), 'prisma/seed/pilot-d4/plans.json'),
  ownersFile: string = resolve(REPO_ROOT, 'services/identity/prisma/seed/pilot-d4/owners.json'),
): PilotPlan[] {
  const plans = z
    .object({ plans: z.array(zPilotPlan) })
    .parse(JSON.parse(readFileSync(plansFile, 'utf8'))).plans;
  const owners = new Map(
    (
      JSON.parse(readFileSync(ownersFile, 'utf8')) as { owners: { slug: string; id: string }[] }
    ).owners.map((owner) => [owner.slug, owner.id]),
  );
  for (const plan of plans) {
    if (owners.get(plan.ownerSlug) !== plan.ownerUserId) {
      throw new Error(`plans.json: ${plan.ownerSlug} does not match identity's owners.json`);
    }
  }
  return plans;
}

/** What the plans seed calls. */
export interface PlansSeedDeps {
  readonly prisma: PrismaService;
  readonly webhooks: Pick<WebhooksService, 'process'>;
}

/** How long to wait for the accounts identity's approvals open, and how often to look. */
export interface SeedWait {
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

const DEFAULT_WAIT: SeedWait = { timeoutMs: 60_000, intervalMs: 500 };

/** Waits until every owner has a billing account; throws naming who is missing. */
export async function waitForAccounts(
  prisma: PrismaService,
  ownerUserIds: readonly string[],
  wait: SeedWait = DEFAULT_WAIT,
): Promise<void> {
  const deadline = Date.now() + wait.timeoutMs;
  for (;;) {
    const found = await prisma.billingAccount.findMany({
      where: { ownerUserId: { in: [...ownerUserIds] } },
      select: { ownerUserId: true },
    });
    const missing = ownerUserIds.filter((id) => !found.some((row) => row.ownerUserId === id));
    if (missing.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `waited ${wait.timeoutMs / 1000} s for billing accounts that identity.owner.verified opens; ` +
          `still missing for ${missing.join(', ')}. Are identity and billing running?`,
      );
    }
    await new Promise((done) => setTimeout(done, wait.intervalMs));
  }
}

/** A synthetic Stripe event, shaped as Stripe sends it. */
function event(id: string, type: string, created: number, object: Record<string, unknown>) {
  return {
    id,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    type,
    created,
    livemode: false,
    data: { object },
  };
}

/**
 * Puts each owner on their corpus plan through billing's webhook processing; an owner already on
 * it is left alone. Returns the report lines.
 */
export async function seedPilotD4Plans(
  deps: PlansSeedDeps,
  plans: readonly PilotPlan[],
  input: { readonly liveMode: boolean; readonly wait?: SeedWait },
): Promise<string[]> {
  if (input.liveMode) {
    throw new Error('the plans seed refuses a live Stripe mode: its subscriptions are synthetic');
  }
  await waitForAccounts(
    deps.prisma,
    plans.map((plan) => plan.ownerUserId),
    input.wait,
  );
  const lines: string[] = [];
  for (const plan of plans) {
    const account = await deps.prisma.billingAccount.findUniqueOrThrow({
      where: { ownerUserId: plan.ownerUserId },
      select: { id: true, plan: { select: { code: true } } },
    });
    if (account.plan.code === plan.planCode) {
      lines.push(`unchanged ${plan.ownerSlug} (${plan.planCode})`);
      continue;
    }
    if (plan.planCode === FREE_PLAN_CODE) {
      lines.push(`skipped ${plan.ownerSlug}: on ${account.plan.code}, the corpus says FREE`);
      continue;
    }
    const price = await deps.prisma.planPrice.findFirst({
      where: {
        billingInterval: 'MONTH',
        isActive: true,
        plan: { code: plan.planCode, deletedAt: null },
      },
      select: { stripePriceId: true },
    });
    if (price === null) {
      throw new Error(
        `${plan.planCode} has no active monthly price: run billing's dev-plans first`,
      );
    }
    const slug = plan.ownerSlug;
    const customer = `cus_seed_${slug}`;
    const subscription = `sub_seed_${slug}`;
    const now = Math.floor(Date.now() / 1000);
    const events = [
      event(`evt_seed_${slug}_1`, 'checkout.session.completed', now, {
        id: `cs_seed_${slug}`,
        object: 'checkout.session',
        mode: 'subscription',
        client_reference_id: account.id,
        customer,
        subscription,
      }),
      event(`evt_seed_${slug}_2`, 'customer.subscription.created', now, {
        id: subscription,
        object: 'subscription',
        customer,
        status: 'active',
        cancel_at_period_end: false,
        items: {
          object: 'list',
          data: [
            {
              price: { id: price.stripePriceId },
              current_period_start: now,
              current_period_end: now + 30 * 24 * 60 * 60,
            },
          ],
        },
      }),
    ];
    for (const raw of events) {
      const row =
        (await deps.prisma.billingEvent.findUnique({
          where: { stripeEventId: raw.id },
          select: { id: true, status: true },
        })) ??
        (await deps.prisma.billingEvent.create({
          data: {
            stripeEventId: raw.id,
            endpoint: StripeEndpoint.PLATFORM,
            livemode: false,
            eventType: raw.type,
            stripeCreatedAt: new Date(raw.created * 1000),
            billingAccountId: account.id,
            payload: raw as unknown as Prisma.InputJsonValue,
            status: BillingEventStatus.RECEIVED,
          },
          select: { id: true, status: true },
        }));
      if (row.status !== String(BillingEventStatus.RECEIVED)) continue;
      const outcome = await deps.webhooks.process({ billingEventId: row.id, attempt: 1 });
      if (outcome !== BillingEventStatus.PROCESSED) {
        throw new Error(`${raw.id} (${raw.type}) ended ${outcome ?? 'unprocessed'}`);
      }
    }
    lines.push(`subscribed ${slug} to ${plan.planCode} (${subscription}, synthetic)`);
  }
  return lines;
}

async function main(): Promise<void> {
  assertNotProduction(process.env);
  config({ path: resolve(packageRoot(__dirname), '.env'), quiet: true });
  if (process.env.PRISMA_DB === 'test') process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const plans = loadPilotPlans();
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ jobs: false }), {
    logger: ['error', 'warn'],
  });
  try {
    const lines = await seedPilotD4Plans(
      { prisma: app.get(PrismaService), webhooks: app.get(WebhooksService) },
      plans,
      { liveMode: process.env.STRIPE_MODE === 'live' },
    );
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
