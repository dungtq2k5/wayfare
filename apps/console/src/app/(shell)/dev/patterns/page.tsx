import { notFound } from 'next/navigation';
import { DEVELOPMENT } from '../../../../env';
import { PatternsLoader } from './loader';

/**
 * The page patterns (K16), development only: a production build answers `404`, and the sample
 * data, imported dynamically, is never in its bundle.
 */
export default function PatternsPage() {
  if (!DEVELOPMENT) notFound();
  return <PatternsLoader />;
}
