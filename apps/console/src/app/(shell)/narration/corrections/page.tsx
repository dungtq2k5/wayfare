import { Corrections } from '../../../../operations/corrections';
import { denial } from '../../../../server/guard';

/** Translation corrections (T1). */
export default async function CorrectionsPage() {
  return (await denial('/narration/corrections')) ?? <Corrections />;
}
