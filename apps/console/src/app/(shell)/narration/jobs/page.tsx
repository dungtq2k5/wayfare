import { NarrationJobs } from '../../../../content/narration-jobs';
import { denial } from '../../../../server/guard';

/** The narration job monitor (J1). */
export default async function NarrationJobsPage() {
  return (await denial('/narration/jobs')) ?? <NarrationJobs />;
}
