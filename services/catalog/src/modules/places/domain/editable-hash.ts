import { contentHash } from '@wayfare/nest-common';
import type { EditableSnapshot } from './submission-diff';

/**
 * `editableHash` (api-endpoints-plan §3.1): the hash of a Venue's owner-editable fields, which an
 * `UPDATE` sends back as its base. Narration, auto-narration and status never move it.
 */
export function editableHash(snapshot: EditableSnapshot): string {
  return contentHash(snapshot);
}
