import { SessionClient, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zInstant = z.iso.datetime({ offset: true });

/** A role as an account's row shows it. */
export const adminUserRoleResponseSchema = z.object({
  id: zUuidV7,
  code: z.string(),
  name: z.string(),
});

/** An account that has not been erased (api-endpoints-plan §1.6). */
export const adminUserResponseSchema = z.object({
  erased: z.literal(false),
  id: zUuidV7,
  email: z.string(),
  fullName: z.string().nullable(),
  roles: z.array(adminUserRoleResponseSchema),
  /** Locked right now: a lapsed lock reads `false`. */
  isLocked: z.boolean(),
  lockedUntil: zInstant.nullable(),
  ownerVerified: z.boolean(),
  isEmailVerified: z.boolean(),
  lastLoginAt: zInstant.nullable(),
  deletedAt: zInstant.nullable(),
  createdAt: zInstant,
});

/** An account, as the console's writes return it. */
export class AdminUserResponseDto extends createZodDto(adminUserResponseSchema) {}

/** An erased account: its id and when, nothing else (ADR 0048). */
export const erasedUserResponseSchema = z.object({
  erased: z.literal(true),
  id: zUuidV7,
  erasedAt: zInstant,
});

/** One row of `GET /admin/users` — discriminated on `erased`. */
export const adminUserListItemResponseSchema = z.discriminatedUnion('erased', [
  adminUserResponseSchema,
  erasedUserResponseSchema,
]);

/** One row of `GET /admin/users`, as a type. */
export type AdminUserListItemResponse = z.output<typeof adminUserListItemResponseSchema>;

/** What both variants share. A class cannot extend a union; the schema stays the full union. */
const erasableUserSchema: z.ZodType<{ erased: boolean; id: string }> =
  adminUserListItemResponseSchema;

/** What `GET /admin/users` returns per item — documented and validated as the union. */
export class AdminUserListItemResponseDto extends createZodDto(erasableUserSchema) {}

/** `GET /admin/users/:id` for a live account. */
export const adminUserDetailResponseSchema = adminUserResponseSchema.extend({
  devicesCount: z.number().int().min(0),
  sessions: z.object({
    live: z.number().int().min(0),
    byClient: z.object({
      [SessionClient.CONSOLE]: z.number().int().min(0),
      [SessionClient.WEB]: z.number().int().min(0),
      [SessionClient.MOBILE]: z.number().int().min(0),
    }),
  }),
  /** Staff-only; set while locked. */
  lockReason: z.string().nullable(),
  /** Owner registration status — not built yet, always `null`. */
  ownerRegistration: z.null(),
});

/** What `GET /admin/users/:id` returns — discriminated on `erased`. */
export const adminUserViewResponseSchema = z.discriminatedUnion('erased', [
  adminUserDetailResponseSchema,
  erasedUserResponseSchema,
]);

/** `GET /admin/users/:id`, as a type. */
export type AdminUserViewResponse = z.output<typeof adminUserViewResponseSchema>;

const erasableUserViewSchema: z.ZodType<{ erased: boolean; id: string }> =
  adminUserViewResponseSchema;

/** What `GET /admin/users/:id` returns under `data` — documented and validated as the union. */
export class AdminUserViewResponseDto extends createZodDto(erasableUserViewSchema) {}

/** `{ user }` — what the console's account writes return. */
export const adminUserResultResponseSchema = z.object({ user: adminUserResponseSchema });

/** What `POST /admin/users`, `PATCH /admin/users/:id` and `PUT …/roles` return under `data`. */
export class AdminUserResultResponseDto extends createZodDto(adminUserResultResponseSchema) {}
