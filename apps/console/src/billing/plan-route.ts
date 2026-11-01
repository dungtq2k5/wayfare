import { ApiError, adminPlansGet } from '@wayfare/api-client';
import type { AdminPlanResponseDto } from '@wayfare/api-client';
import { serverCall } from '../server/api';

/** A live plan read on the server with the caller's session; `null` when none (or retired, K17). */
export async function planOnServer(id: string): Promise<AdminPlanResponseDto | null> {
  try {
    return (await serverCall((options) => adminPlansGet(id, options))).data;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED'))
      return null;
    throw error;
  }
}
