import { LegalDocument, LegalParty, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /devices` response. `deviceSecret` is returned exactly once. */
export const registerDeviceResponseSchema = z.object({
  deviceId: zUuidV7,
  deviceSecret: z.string().min(1),
  accessToken: z.string().min(1),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().min(0),
});

/** What `POST /devices` returns under `data`. */
export class RegisterDeviceResponseDto extends createZodDto(registerDeviceResponseSchema) {}

/** `POST /devices/token` response. */
export const deviceTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().min(0),
});

/** What `POST /devices/token` returns under `data`. */
export class DeviceTokenResponseDto extends createZodDto(deviceTokenResponseSchema) {}

/** `PATCH /devices/me` response. The push token is never echoed. */
export const deviceResponseSchema = z.object({
  deviceId: zUuidV7,
  appVersion: z.string(),
  osVersion: z.string().nullable(),
  contentLocale: z.string(),
});

/** What `PATCH /devices/me` returns under `data`. */
export class DeviceResponseDto extends createZodDto(deviceResponseSchema) {}

/** A legal acceptance as clients see it (api-endpoints-plan §1.3). */
export const legalAcceptanceResponseSchema = z.object({
  party: z.enum(LegalParty),
  document: z.enum(LegalDocument),
  version: z.string(),
  acceptedAt: z.iso.datetime({ offset: true }),
});

/** What a legal-acceptance write returns under `data`. */
export class LegalAcceptanceResponseDto extends createZodDto(legalAcceptanceResponseSchema) {}
