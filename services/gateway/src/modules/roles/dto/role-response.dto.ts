import { zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A role with its grants (api-endpoints-plan §1.6). */
export const roleResponseSchema = z.object({
  id: zUuidV7,
  /** Generated once from the name; never changes. */
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissionCodes: z.array(z.string()),
  /** Live accounts holding the role. */
  holders: z.number().int().min(0),
});

/** One role, as `GET /admin/roles` lists it. */
export class RoleResponseDto extends createZodDto(roleResponseSchema) {}

/** `{ role }` — what the role writes return. */
export const roleResultResponseSchema = z.object({ role: roleResponseSchema });

/** What `POST /admin/roles`, `PATCH …/:id` and `PUT …/permissions` return under `data`. */
export class RoleResultResponseDto extends createZodDto(roleResultResponseSchema) {}

/** One section of the role editor (api-endpoints-plan §11). */
export const permissionGroupResponseSchema = z.object({
  group: z.string(),
  permissions: z.array(
    z.object({ code: z.string(), description: z.string(), isRetired: z.boolean() }),
  ),
});

/** What `GET /admin/permissions` returns per group. */
export class PermissionGroupResponseDto extends createZodDto(permissionGroupResponseSchema) {}
