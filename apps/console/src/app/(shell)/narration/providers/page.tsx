import { NarrationProviders } from '../../../../content/narration-providers';
import { denial } from '../../../../server/guard';

/** The narration providers (J5), under the jobs' own permission. */
export default async function NarrationProvidersPage() {
  return (await denial('/narration/jobs')) ?? <NarrationProviders />;
}
