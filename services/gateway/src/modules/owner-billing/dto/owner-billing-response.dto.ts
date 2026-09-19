import { zBillingOverview, zInvoice, zPlan, zSessionUrl } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** `GET /owner/billing` — read from Postgres, never Stripe. */
export class BillingOverviewResponseDto extends createZodDto(zBillingOverview) {}

/** A plan an owner may move to, with its grants and active prices. */
export class PlanResponseDto extends createZodDto(zPlan) {}

/** A Stripe-hosted page's URL. */
export class SessionUrlResponseDto extends createZodDto(zSessionUrl) {}

/** One invoice, as Stripe lists it. */
export class InvoiceResponseDto extends createZodDto(zInvoice) {}
