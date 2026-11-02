import { Suspense } from 'react';
import { OwnerBilling } from '../../../../owner/billing';
import { denial } from '../../../../server/guard';

/** Plan and billing (Y1–Y7). */
export default async function Page() {
  const denied = await denial('/owner/billing');
  if (denied !== null) return denied;
  return (
    <Suspense>
      <OwnerBilling />
    </Suspense>
  );
}
