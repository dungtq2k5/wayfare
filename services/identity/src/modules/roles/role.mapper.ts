import { compareStrings } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import type { Prisma } from '../../../generated/prisma/client';

/** A role with its grants and its live holders (rdm-spec I-4, I-6, I-7). */
export const ROLE_VIEW_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: { select: { permissionCode: true } },
  _count: { select: { users: { where: { user: { deletedAt: null } } } } },
} as const satisfies Prisma.RoleSelect;

/** A role as `ROLE_VIEW_SELECT` loads it. */
export type RoleViewRow = Prisma.RoleGetPayload<{ select: typeof ROLE_VIEW_SELECT }>;

/** A role on the wire: codes sorted, `holders` the live accounts holding it. */
export function toRole(row: RoleViewRow): identityGrpc.Role {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    isSystem: row.isSystem,
    permissionCodes: row.permissions.map((grant) => grant.permissionCode).toSorted(compareStrings),
    holders: row._count.users,
  };
}
