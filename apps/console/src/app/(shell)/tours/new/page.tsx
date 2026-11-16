import { TourForm } from '../../../../content/tour-form';
import { denial } from '../../../../server/guard';

/** Create a tour (TA3, TA3c). */
export default async function NewTourPage() {
  return (await denial('/tours')) ?? <TourForm tour={null} />;
}
