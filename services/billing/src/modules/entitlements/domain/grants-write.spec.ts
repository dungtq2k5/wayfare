import { FREE_PLAN_GRANTS, NarrationLanguageScope } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { grantColumns, grantsOf, plannedGrantsWrite } from './grants-write';

describe('grants-write', () => {
  it('round-trips the grant columns', () => {
    expect(grantsOf(grantColumns(FREE_PLAN_GRANTS))).toEqual(FREE_PLAN_GRANTS);
  });

  it('bumps the version only on a change', () => {
    expect(plannedGrantsWrite(FREE_PLAN_GRANTS, 4, { ...FREE_PLAN_GRANTS })).toEqual({
      changed: false,
      version: 4,
    });
    const wider = { ...FREE_PLAN_GRANTS, narrationLanguageScope: NarrationLanguageScope.LAUNCH };
    expect(plannedGrantsWrite(FREE_PLAN_GRANTS, 4, wider)).toEqual({
      changed: true,
      version: 5,
      previous: FREE_PLAN_GRANTS,
    });
  });
});
