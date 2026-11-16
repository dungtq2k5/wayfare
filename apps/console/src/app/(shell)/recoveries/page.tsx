import { Recoveries } from '../../../operations/recoveries';
import { denial } from '../../../server/guard';

/** Recoveries (V1). */
export default async function RecoveriesPage() {
  return (await denial('/recoveries')) ?? <Recoveries />;
}
