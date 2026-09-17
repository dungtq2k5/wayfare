import { zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The signed-in person (api-endpoints-plan §1.3). */
export const userResponseSchema = z.object({
  id: zUuidV7,
  email: z.string(),
  fullName: z.string().nullable(),
  preferredLocale: z.string(),
  isEmailVerified: z.boolean(),
  /** A hard bounce was recorded since the address was last verified — the console's banner. */
  emailBounced: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});

/** The account, as every session and account response carries it. */
export class UserResponseDto extends createZodDto(userResponseSchema) {}

/** `GET /users/me` — the console's bootstrap read. */
export const meResponseSchema = z.object({
  user: userResponseSchema,
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  ownerVerified: z.boolean(),
});

/** What `GET /users/me` returns under `data`. */
export class MeResponseDto extends createZodDto(meResponseSchema) {}

/** `PATCH /users/me` response. */
export const updateMeResponseSchema = z.object({ user: userResponseSchema });

/** What `PATCH /users/me` returns under `data`. */
export class UpdateMeResponseDto extends createZodDto(updateMeResponseSchema) {}
