import { Pronunciation } from '../../../../operations/pronunciation';
import { denial } from '../../../../server/guard';

/** The pronunciation dictionary, frame D1. */
export default async function PronunciationPage() {
  return (await denial('/narration/pronunciation')) ?? <Pronunciation />;
}
