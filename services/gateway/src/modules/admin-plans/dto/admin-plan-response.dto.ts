import { zAdminPlan, zApplyResult, zPriceLookup } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A catalogue plan with every price and its subscribers. */
export class AdminPlanResponseDto extends createZodDto(zAdminPlan) {}

/** `{ plan }`, as the plan writes return it. */
export const adminPlanResultResponseSchema = z.object({ plan: zAdminPlan }).strict();

/** What the plan writes return under `data`. */
export class AdminPlanResultResponseDto extends createZodDto(adminPlanResultResponseSchema) {}

/** An apply, or its dry run. */
export class ApplyResultResponseDto extends createZodDto(zApplyResult) {}

/** A price looked up before registering it. */
export class PriceLookupResponseDto extends createZodDto(zPriceLookup) {}
