import { ToursList } from '../../../content/tours-list';
import { denial } from '../../../server/guard';

/** The tours list (TA1, TA5c). */
export default async function ToursPage() {
  return (await denial('/tours')) ?? <ToursList />;
}
