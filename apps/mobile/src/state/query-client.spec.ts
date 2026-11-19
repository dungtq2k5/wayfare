import { ApiError } from '@wayfare/api-client';
import { describe, expect, it, vi } from 'vitest';
import { memoryKv } from '../testing/shell-fakes';

vi.mock('expo-sqlite/kv-store', () => ({ default: memoryKv() }));

const { queryClient } = await import('./query-client');
const { useAppStore } = await import('./app-store');

type Retry = (failures: number, error: Error) => boolean;
const retry = queryClient.getDefaultOptions().queries!.retry as Retry;

describe('the one query client (ADR 0029)', () => {
  it('tries a transport failure or a gateway fault again, twice at most', () => {
    expect(retry(0, new Error('network'))).toBe(true);
    expect(retry(1, new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'x'))).toBe(true);
    expect(retry(2, new Error('network'))).toBe(false);
  });

  it('never tries a refusal again: it is the answer', () => {
    expect(retry(0, new ApiError(404, 'RESOURCE_NOT_FOUND', 'x'))).toBe(false);
    expect(retry(0, new ApiError(409, 'INVALID_STATE', 'x'))).toBe(false);
  });

  it('routes an app-wide refusal from any query or mutation', async () => {
    const outdated = new ApiError(426, 'APP_VERSION_UNSUPPORTED', 'x', { minimumVersion: '3.0.0' });
    await queryClient
      .fetchQuery({ queryKey: ['q'], queryFn: () => Promise.reject(outdated), retry: false })
      .catch(() => undefined);
    expect(useAppStore.getState().updateRequired).toBe('3.0.0');
    const policy = new ApiError(409, 'LEGAL_VERSION_OUTDATED', 'x', {
      currentVersion: '2027-01-01',
    });
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => Promise.reject(policy) })
      .execute(undefined)
      .catch(() => undefined);
    expect(useAppStore.getState().policyVersion).toBe('2027-01-01');
  });
});
