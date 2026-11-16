import { SubmissionsView } from '../../../../owner/submissions';
import { denial } from '../../../../server/guard';

/** My submissions (Q1). */
export default async function Page() {
  const denied = await denial('/owner/submissions');
  if (denied !== null) return denied;
  return <SubmissionsView />;
}
