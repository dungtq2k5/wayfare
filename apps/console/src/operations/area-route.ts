import { ApiError, adminAreasGet } from '@wayfare/api-client';
import type { AdminAreaResponseDto } from '@wayfare/api-client';
import { serverCall } from '../server/api';

/** An area read on the server with the caller's session; `null` when there is none by that id. */
export async function areaOnServer(id: string): Promise<AdminAreaResponseDto | null> {
  try {
    return (await serverCall((options) => adminAreasGet(id, options))).data.area;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED'))
      return null;
    throw error;
  }
}
