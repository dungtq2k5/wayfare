import { MapPin, Soup } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { categoryIcon } from './category-icon';
import { operationHasUndo } from './undo';
import type { OperationAction } from './undo';

describe('categoryIcon', () => {
  it("draws a mapped code's icon, and a new code as the pin", () => {
    expect(categoryIcon('STREET_FOOD')).toBe(Soup);
    expect(categoryIcon('NIGHT_MARKET')).toBe(MapPin);
  });
});

describe('operationHasUndo', () => {
  it("gives Undo to a category's deactivation only", () => {
    const others: OperationAction[] = [
      'pack.publish',
      'area.activation',
      'pronunciation.save',
      'pronunciation.delete',
      'correction.save',
      'correction.revert',
      'user.change',
      'role.save',
      'role.delete',
      'recovery.decide',
      'narration.again',
    ];
    expect(operationHasUndo('category.deactivate')).toBe(true);
    for (const action of others) expect(operationHasUndo(action), action).toBe(false);
  });
});
