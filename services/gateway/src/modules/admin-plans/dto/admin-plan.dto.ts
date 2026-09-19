import {
  zApplyPlanQuery,
  zPlanInput,
  zPlanUpdateInput,
  zRegisterPriceInput,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/admin/plans/:id`. */
export const planIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated plan path parameter. */
export class PlanIdParamDto extends createZodDto(planIdParamSchema) {}

/** Validated `POST /admin/plans` body (api-endpoints-plan §6.1): every grant required. */
export class CreatePlanDto extends createZodDto(zPlanInput) {}

/** Validated `PATCH /admin/plans/:id` body: the catalogue row only. */
export class UpdatePlanDto extends createZodDto(zPlanUpdateInput) {}

/** Validated `POST /admin/plans/:id/prices` body. */
export class RegisterPriceDto extends createZodDto(zRegisterPriceInput) {}

/** Validated `POST /admin/plans/:id/apply` query. */
export class ApplyPlanQueryDto extends createZodDto(zApplyPlanQuery) {}
