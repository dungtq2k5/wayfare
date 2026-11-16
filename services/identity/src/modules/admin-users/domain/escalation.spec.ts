import { ADMIN_EXCLUDED_PERMISSIONS, compareStrings, PERMISSION_CODES } from '@wayfare/contracts';
import { SYSTEM_ROLE_GRANTS, SystemRole } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { addedCodesActorLacks, targetCodesActorLacks } from './escalation';

const superAdmin = SYSTEM_ROLE_GRANTS[SystemRole.SUPER_ADMIN];
const admin = SYSTEM_ROLE_GRANTS[SystemRole.ADMIN];

describe('addedCodesActorLacks', () => {
  it('nothing added → nothing lacking', () => {
    expect(
      addedCodesActorLacks({ actorCodes: [], before: ['user.read'], after: ['user.read'] }),
    ).toEqual([]);
  });

  it('an addition the actor holds passes', () => {
    expect(
      addedCodesActorLacks({ actorCodes: ['audit.read'], before: [], after: ['audit.read'] }),
    ).toEqual([]);
  });

  it('lists every addition the actor lacks, sorted', () => {
    expect(
      addedCodesActorLacks({
        actorCodes: ['user.read'],
        before: [],
        after: ['user.read', 'role.update', 'billing.refund.create'],
      }),
    ).toEqual(['billing.refund.create', 'role.update']);
  });

  it('a SUPER_ADMIN never lacks anything', () => {
    expect(
      addedCodesActorLacks({ actorCodes: superAdmin, before: [], after: PERMISSION_CODES }),
    ).toEqual([]);
  });

  it('removing codes the actor lacks is not an escalation', () => {
    expect(addedCodesActorLacks({ actorCodes: [], before: ['role.update'], after: [] })).toEqual(
      [],
    );
  });
});

describe('targetCodesActorLacks', () => {
  it('an ADMIN against a SUPER_ADMIN lacks exactly the excluded codes', () => {
    expect(targetCodesActorLacks({ actorCodes: admin, targetCodes: superAdmin })).toEqual(
      [...ADMIN_EXCLUDED_PERMISSIONS].toSorted(compareStrings),
    );
  });

  it('an ADMIN against an ADMIN, or a SUPER_ADMIN against anyone, lacks nothing', () => {
    expect(targetCodesActorLacks({ actorCodes: admin, targetCodes: admin })).toEqual([]);
    expect(targetCodesActorLacks({ actorCodes: superAdmin, targetCodes: superAdmin })).toEqual([]);
  });
});
