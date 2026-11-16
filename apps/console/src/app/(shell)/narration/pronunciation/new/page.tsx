import { PronunciationForm } from '../../../../../operations/pronunciation-form';
import { denial } from '../../../../../server/guard';

/** A new pronunciation entry, frame D2. */
export default async function NewEntryPage() {
  return (await denial('/narration/pronunciation')) ?? <PronunciationForm entry={null} />;
}
