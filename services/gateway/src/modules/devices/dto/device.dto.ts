import {
  MAX_LANGUAGE_CODE_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  MAX_VERSION_LENGTH,
  Platform,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /devices` body (api-endpoints-plan §1.1). Strict: an unknown field is a 400, not a silent drop. */
export const registerDeviceBodySchema = z
  .object({
    platform: z.enum(Platform),
    appVersion: z.string().trim().min(1).max(MAX_VERSION_LENGTH),
    osVersion: z.string().trim().min(1).max(MAX_VERSION_LENGTH).optional(),
    contentLocale: z.string().trim().min(2).max(MAX_LANGUAGE_CODE_LENGTH),
    privacyPolicyVersion: z.string().trim().min(1).max(MAX_POLICY_VERSION_LENGTH),
  })
  .strict();

/** Validated `POST /devices` body. */
export class RegisterDeviceDto extends createZodDto(registerDeviceBodySchema) {}
