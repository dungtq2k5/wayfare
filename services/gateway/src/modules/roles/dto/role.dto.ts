import {
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
  PERMISSION_CODES,
  zPermissionCodeShape,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zName = z.string().trim().min(1).max(MAX_ROLE_NAME_LENGTH);

/**
 * Permission codes by shape, de-duplicated and bounded. An unknown well-formed code reaches
 * identity, whose catalogue may be newer than this gateway, and is refused there.
 */
const zPermissionCodes = z
  .array(zPermissionCodeShape)
  .max(PERMISSION_CODES.length)
  .transform((codes) => [...new Set(codes)]);

/** `/admin/roles/:id`. */
export const roleIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated role path parameter. */
export class RoleIdParamDto extends createZodDto(roleIdParamSchema) {}

/** `POST /admin/roles` body (api-endpoints-plan §1.6). */
export const createRoleBodySchema = z
  .object({
    name: zName,
    description: z.string().trim().max(MAX_ROLE_DESCRIPTION_LENGTH).optional(),
    permissionCodes: zPermissionCodes,
  })
  .strict();

/** Validated `POST /admin/roles` body. */
export class CreateRoleDto extends createZodDto(createRoleBodySchema) {}

/** `PATCH /admin/roles/:id` body; `description: null` clears it. */
export const updateRoleBodySchema = z
  .object({
    name: zName.optional(),
    description: z.string().trim().max(MAX_ROLE_DESCRIPTION_LENGTH).nullable().optional(),
  })
  .strict();

/** Validated `PATCH /admin/roles/:id` body. */
export class UpdateRoleDto extends createZodDto(updateRoleBodySchema) {}

/** `PUT /admin/roles/:id/permissions` body — the whole set. */
export const setRolePermissionsBodySchema = z
  .object({ permissionCodes: zPermissionCodes })
  .strict();

/** Validated `PUT /admin/roles/:id/permissions` body. */
export class SetRolePermissionsDto extends createZodDto(setRolePermissionsBodySchema) {}
