import { zBillingAccountDetail, zBillingAccountSummary, zBillingEvent } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** An account row. */
export class BillingAccountSummaryResponseDto extends createZodDto(zBillingAccountSummary) {}

/** An account's detail. */
export class BillingAccountDetailResponseDto extends createZodDto(zBillingAccountDetail) {}

/** `{ account }`, as the pin writes return it. */
export const billingAccountResultResponseSchema = z
  .object({ account: zBillingAccountDetail })
  .strict();

/** What the pin writes return under `data`. */
export class BillingAccountResultResponseDto extends createZodDto(
  billingAccountResultResponseSchema,
) {}

/** A recorded Stripe event, its payload included. */
export class BillingEventResponseDto extends createZodDto(zBillingEvent) {}

/** `{ event }`, as a replay returns it. */
export const billingEventResultResponseSchema = z.object({ event: zBillingEvent }).strict();

/** What a replay returns under `data`. */
export class BillingEventResultResponseDto extends createZodDto(billingEventResultResponseSchema) {}
