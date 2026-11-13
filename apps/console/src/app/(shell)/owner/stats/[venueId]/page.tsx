import { zUuidV7 } from '@wayfare/contracts';
import { Suspense } from 'react';
import { VenueStatsView } from '../../../../../owner/venue-stats';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** A Venue's stats (AO2, AO3b, AO5); an id that can't be a Venue is not found at once. */
export default async function Page({ params }: { params: Promise<{ venueId: string }> }) {
  const denied = await denial('/owner/stats');
  if (denied !== null) return denied;
  const { venueId } = await params;
  if (!zUuidV7.safeParse(venueId).success) return <NotFoundView />;
  return (
    <Suspense>
      <VenueStatsView venueId={venueId} />
    </Suspense>
  );
}
