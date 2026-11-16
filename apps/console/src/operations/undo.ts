/** Everything this round's pages change, by what the person did. */
export type OperationAction =
  | 'category.deactivate'
  | 'pack.publish'
  | 'area.activation'
  | 'pronunciation.save'
  | 'pronunciation.delete'
  | 'correction.save'
  | 'correction.revert'
  | 'user.change'
  | 'role.save'
  | 'role.delete'
  | 'recovery.decide'
  | 'narration.again';

/**
 * Whether an action's toast offers *Undo* (round 33's rule: only a plain inverse). Only a category's
 * deactivation: nobody is told, and reactivating is its inverse; every other action is seen,
 * signs someone out, emails, refunds or starts narration at once.
 */
export const operationHasUndo = (action: OperationAction): boolean =>
  action === 'category.deactivate';
