/**
 * The fields an owner edits — a submission's payload, its stored base and a conflict's
 * `changedFields` all name these (rdm-spec C-11).
 */
export const SUBMISSION_EDITABLE_FIELDS = [
  'nameVi',
  'descriptionVi',
  'categoryCode',
  'location',
  'addressVi',
  'priceBand',
  'phone',
  'websiteUrl',
  'openingHours',
  'photos',
  'menu',
] as const;
/** One owner-editable field. */
export type SubmissionEditableField = (typeof SUBMISSION_EDITABLE_FIELDS)[number];
