'use client';

import { useQuery } from '@tanstack/react-query';
import { adminOwnerRegistrationsList, adminSubmissionsList } from '@wayfare/api-client';
import { useMe } from './me';

/** Every minute while the tab is visible (K9). */
const QUEUE_REFRESH_MS = 60_000;

/**
 * The pending counts beside *Submissions* and *Registrations* (K9): each list read with
 * `pageSize=1` for its `meta.total`, on navigation and every minute while the tab is visible.
 * ponytail: polled — no socket event carries them; add a `queue:counts` event when a minute is too
 * slow.
 */
export function useQueueCounts(): { submissions?: number; registrations?: number } {
  const { permissions } = useMe();
  const submissions = useQuery({
    queryKey: ['queue', 'submissions'],
    queryFn: () => adminSubmissionsList({ status: 'PENDING', pageSize: 1 }),
    enabled: permissions.includes('submission.read'),
    refetchInterval: QUEUE_REFRESH_MS,
    refetchOnMount: 'always',
  });
  const registrations = useQuery({
    queryKey: ['queue', 'registrations'],
    queryFn: () => adminOwnerRegistrationsList({ status: 'PENDING', pageSize: 1 }),
    enabled: permissions.includes('owner_registration.read'),
    refetchInterval: QUEUE_REFRESH_MS,
    refetchOnMount: 'always',
  });
  return {
    ...(submissions.data === undefined ? {} : { submissions: submissions.data.meta.total }),
    ...(registrations.data === undefined ? {} : { registrations: registrations.data.meta.total }),
  };
}
