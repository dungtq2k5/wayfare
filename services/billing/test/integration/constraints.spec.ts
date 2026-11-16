// Each rdm-spec §5 billing object refuses the row it exists to refuse (ADR 0045).
import { newId } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';

const prisma = testPrisma();

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

/** The constraint a statement violated, from the driver error. */
async function violated(run: () => PromiseLike<unknown>): Promise<string> {
  const error = await Promise.resolve(run()).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'the statement should have been refused').not.toBeNull();
  return JSON.stringify(error, Object.getOwnPropertyNames(error));
}

function insertPlan(code: string, over: { vouchers?: boolean; bps?: number | null } = {}) {
  const id = newId();
  const vouchers = over.vouchers ?? false;
  const bps = over.bps === undefined ? (vouchers ? 1500 : null) : over.bps;
  return {
    id,
    run: () => prisma.$executeRaw`
      INSERT INTO plans (id, code, name, sort_order, max_places, auto_narration,
        narration_language_scope, max_photos_per_place, max_menu_items_per_place,
        discovery_boost_slots, ai_credits_per_day, analytics_level, can_sell_vouchers,
        voucher_commission_bps)
      VALUES (${id}::uuid, ${code}, ${code}, 1, 10, true, 'LAUNCH', 8, 200, 1, 10, 'BASIC',
        ${vouchers}, ${bps})`,
  };
}

function insertPrice(
  planId: string,
  over: { active?: boolean; currency?: string; amount?: number } = {},
) {
  return prisma.$executeRaw`
    INSERT INTO plan_prices (id, plan_id, stripe_price_id, billing_interval, amount_minor, currency, is_active)
    VALUES (${newId()}::uuid, ${planId}::uuid, ${`price_${newId().replaceAll('-', '')}`}, 'MONTH',
      ${over.amount ?? 900}, ${over.currency ?? 'USD'}, ${over.active ?? true})`;
}

describe('billing schema objects (rdm-spec §5)', () => {
  it('plans_code_live_key refuses a second live plan with a code, not a retired one', async () => {
    await insertPlan('GROWTH').run();
    expect(await violated(insertPlan('GROWTH').run)).toContain('plans_code_live_key');
    await prisma.$executeRaw`UPDATE plans SET deleted_at = now() WHERE code = 'GROWTH'`;
    await insertPlan('GROWTH').run();
  });

  it('plans_commission_ck ties the commission to selling vouchers, within bounds', async () => {
    expect(await violated(insertPlan('A', { vouchers: true, bps: null }).run)).toContain(
      'plans_commission_ck',
    );
    expect(await violated(insertPlan('B', { vouchers: false, bps: 1000 }).run)).toContain(
      'plans_commission_ck',
    );
    expect(await violated(insertPlan('C', { vouchers: true, bps: 3001 }).run)).toContain(
      'plans_commission_ck',
    );
  });

  it('plan_prices_one_active_interval allows one active price per interval', async () => {
    const plan = insertPlan('GROWTH');
    await plan.run();
    await insertPrice(plan.id);
    await insertPrice(plan.id, { active: false });
    expect(await violated(() => insertPrice(plan.id))).toContain('plan_prices_one_active_interval');
  });

  it('plan prices are USD, in positive minor units', async () => {
    const plan = insertPlan('GROWTH');
    await plan.run();
    expect(await violated(() => insertPrice(plan.id, { currency: 'EUR' }))).toContain(
      'plan_prices_currency_ck',
    );
    expect(await violated(() => insertPrice(plan.id, { amount: 0 }))).toContain(
      'plan_prices_amount_ck',
    );
  });
});
