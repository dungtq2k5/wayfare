import {
  MAX_ADMIN_REASON_LENGTH,
  MAX_FULL_NAME_LENGTH,
  MAX_LOCK_DURATION_MS,
  MAX_LOCK_REASON_LENGTH,
  MAX_ROLES_PER_USER,
  zBooleanParam,
  zEmail,
  zPageQuery,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zFullName = z.string().trim().min(1).max(MAX_FULL_NAME_LENGTH);

/** A role set: de-duplicated, bounded. */
const zRoleIds = z
  .array(zUuidV7)
  .max(MAX_ROLES_PER_USER)
  .transform((ids) => [...new Set(ids)]);

/** `GET /admin/users` query (api-endpoints-plan §1.6). */
export const listUsersQuerySchema = zPageQuery({
  sort: ['createdAt', 'email', 'lastLoginAt'],
  defaultSort: '-createdAt',
  search: true,
}).extend({
  roleId: zUuidV7.optional(),
  isLocked: zBooleanParam,
  ownerVerified: zBooleanParam,
  includeDeleted: zBooleanParam,
});

/** Validated `GET /admin/users` query. */
export class ListUsersQueryDto extends createZodDto(listUsersQuerySchema) {}

/** `/admin/users/:id`. */
export const userIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated user path parameter. */
export class UserIdParamDto extends createZodDto(userIdParamSchema) {}

/** `POST /admin/users` body. */
export const createStaffUserBodySchema = z
  .object({
    email: zEmail,
    fullName: zFullName,
    roleIds: zRoleIds.pipe(z.array(z.string()).min(1)),
  })
  .strict();

/** Validated `POST /admin/users` body. */
export class CreateStaffUserDto extends createZodDto(createStaffUserBodySchema) {}

/** `PATCH /admin/users/:id` body. Nothing is defaulted. */
export const updateUserBodySchema = z.object({ fullName: zFullName.optional() }).strict();

/** Validated `PATCH /admin/users/:id` body. */
export class UpdateUserDto extends createZodDto(updateUserBodySchema) {}

/** `PUT /admin/users/:id/roles` body — the whole set; empty is allowed. */
export const setUserRolesBodySchema = z.object({ roleIds: zRoleIds }).strict();

/** Validated `PUT /admin/users/:id/roles` body. */
export class SetUserRolesDto extends createZodDto(setUserRolesBodySchema) {}

/** `POST /admin/users/:id/lock` body: `lockedUntil` in the future, at most a year away. */
export const lockUserBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(MAX_LOCK_REASON_LENGTH),
    lockedUntil: z.iso
      .datetime({ offset: true })
      .refine(
        (value) => {
          const at = Date.parse(value);
          return at > Date.now() && at <= Date.now() + MAX_LOCK_DURATION_MS;
        },
        { message: 'Must be in the future, at most a year away' },
      )
      .optional(),
  })
  .strict();

/** Validated `POST /admin/users/:id/lock` body. */
export class LockUserDto extends createZodDto(lockUserBodySchema) {}

/** `DELETE /admin/users/:id` body. */
export const deactivateUserBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(MAX_ADMIN_REASON_LENGTH),
    refundUnredeemedVouchers: z.boolean().optional(),
  })
  .strict();

/** Validated `DELETE /admin/users/:id` body. */
export class DeactivateUserDto extends createZodDto(deactivateUserBodySchema) {}
