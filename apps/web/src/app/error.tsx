'use client';

import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
import { WebErrorState } from '../ui/error-state';

/**
 * A page that couldn't be made because a read on the server failed (the map's areas): the web's
 * error state, never "this page doesn't exist". *Try again* refreshes the router too — `reset()`
 * alone would draw the same failed server component again. A server error reaches the boundary
 * as a `digest`, with no request id, so that row isn't drawn.
 */
export default function PageError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <main id="content" tabIndex={-1} className="flex flex-1 flex-col px-4 py-6 outline-none">
      <WebErrorState
        error={null}
        onRetry={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      />
    </main>
  );
}
