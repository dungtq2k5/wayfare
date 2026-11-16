'use client';

import type { PermissionCode } from '@wayfare/contracts';
import { useMe } from './me';

/** Whether the signed-in person holds a permission: each action shows only for its holder (K2). */
export function useCan(): (code: PermissionCode) => boolean {
  const { permissions } = useMe();
  return (code) => permissions.includes(code);
}
