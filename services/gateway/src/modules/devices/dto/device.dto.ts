import {
  LegalDocument,
  MAX_LANGUAGE_CODE_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  MAX_PUSH_TOKEN_LENGTH,
  MAX_VERSION_LENGTH,
  Platform,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zVersion = z.string().trim().min(1).max(MAX_VERSION_LENGTH);
const zLocale = z.string().trim().min(2).max(MAX_LANGUAGE_CODE_LENGTH);

/** `POST /devices` body (api-endpoints-plan §1.1). Strict: an unknown field is a 400, not a silent drop. */
export const registerDeviceBodySchema = z
  .object({
    platform: z.enum(Platform),
    appVersion: zVersion,
    osVersion: zVersion.optional(),
    contentLocale: zLocale,
    privacyPolicyVersion: z.string().trim().min(1).max(MAX_POLICY_VERSION_LENGTH),
  })
  .strict();

/** Validated `POST /devices` body. */
export class RegisterDeviceDto extends createZodDto(registerDeviceBodySchema) {}

/** `POST /devices/token` body. */
export const exchangeDeviceTokenBodySchema = z
  .object({ deviceId: zUuidV7, deviceSecret: z.string().min(1).max(256) })
  .strict();

/** Validated `POST /devices/token` body. */
export class ExchangeDeviceTokenDto extends createZodDto(exchangeDeviceTokenBodySchema) {}

/** `PATCH /devices/me` body. Nothing is defaulted: an absent field stays unchanged. */
export const updateDeviceBodySchema = z
  .object({
    appVersion: zVersion.optional(),
    osVersion: zVersion.optional(),
    contentLocale: zLocale.optional(),
    pushToken: z.string().trim().min(1).max(MAX_PUSH_TOKEN_LENGTH).optional(),
  })
  .strict();

/** Validated `PATCH /devices/me` body. */
export class UpdateDeviceDto extends createZodDto(updateDeviceBodySchema) {}

/** `POST /devices/me/legal-acceptances` and `/users/me/legal-acceptances` body. */
export const recordLegalAcceptanceBodySchema = z
  .object({
    document: z.enum(LegalDocument),
    version: z.string().trim().min(1).max(MAX_POLICY_VERSION_LENGTH),
  })
  .strict();

/** Validated legal acceptance body. */
export class RecordLegalAcceptanceDto extends createZodDto(recordLegalAcceptanceBodySchema) {}
