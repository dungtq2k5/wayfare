import { SubmissionsList } from '../../../content/submissions-list';
import { denial } from '../../../server/guard';

/** The submission queue (S1). */
export default async function SubmissionsPage() {
  return (await denial('/submissions')) ?? <SubmissionsList />;
}
