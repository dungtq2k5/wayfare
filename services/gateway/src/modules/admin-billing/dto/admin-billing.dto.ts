import {
  zBillingAccountsQuery,
  zBillingEventsQuery,
  zEntitlementOverrideInput,
  zUnpinInput,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/admin/billing/accounts/:id` and `/admin/billing/events/:id`. */
export const billingIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated account or event path parameter. */
export class BillingIdParamDto extends createZodDto(billingIdParamSchema) {}

/** Validated `GET /admin/billing/accounts` query (api-endpoints-plan §6.2). */
export class BillingAccountsQueryDto extends createZodDto(zBillingAccountsQuery) {}

/** Validated `GET /admin/billing/events` query. */
export class BillingEventsQueryDto extends createZodDto(zBillingEventsQuery) {}

/** Validated `PATCH /admin/billing/accounts/:id/entitlements` body. */
export class OverrideEntitlementsDto extends createZodDto(zEntitlementOverrideInput) {}

/** Validated `POST /admin/billing/accounts/:id/unpin` body. */
export class UnpinDto extends createZodDto(zUnpinInput) {}
