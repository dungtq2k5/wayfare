import { ApiError, adminBillingAccount } from '@wayfare/api-client';
import type { BillingAccountDetailResponseDto } from '@wayfare/api-client';
import { serverCall } from '../server/api';

/** A billing account read on the server with the caller's session; `null` when there is none. */
export async function accountOnServer(id: string): Promise<BillingAccountDetailResponseDto | null> {
  try {
    return (await serverCall((options) => adminBillingAccount(id, options))).data;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED'))
      return null;
    throw error;
  }
}
