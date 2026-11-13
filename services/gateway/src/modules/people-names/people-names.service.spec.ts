import { buildAccountContext } from '@wayfare/nest-common/testing';
import { describe, expect, it, vi } from 'vitest';
import type { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import { PeopleNamesService, visibleName } from './people-names.service';

const reader = buildAccountContext({ permissions: ['user.read'] });
const moderator = buildAccountContext({ permissions: ['pronunciation.manage'] });

function names(users: { id: string; name?: string }[]) {
  const call = vi.fn().mockResolvedValue({ users });
  const identity = { adminUsers: { call } } as unknown as IdentityServiceGrpcClient;
  return { people: new PeopleNamesService(identity), call };
}

describe('the names rule', () => {
  it('a caller with user.read reads names; an erased or unknown id reads null', async () => {
    const { people, call } = names([{ id: 'a', name: 'Lan Pham' }, { id: 'b' }]);
    const nameOf = await people.of(reader, ['a', 'b', 'c', null, 'a']);
    expect(nameOf('a')).toEqual({ id: 'a', name: 'Lan Pham' });
    expect(nameOf('b').name).toBeNull();
    expect(nameOf('c').name).toBeNull();
    expect(call).toHaveBeenCalledWith('getUserNames', { userIds: ['a', 'b', 'c'] }, reader);
  });

  it('without user.read nothing is asked, and every name is null', async () => {
    const { people, call } = names([{ id: 'a', name: 'Lan Pham' }]);
    expect((await people.of(moderator, ['a']))('a').name).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("identity's own joined names follow the same rule", () => {
    expect(visibleName(reader, 'Mai Anh')).toBe('Mai Anh');
    expect(visibleName(reader, undefined)).toBeNull();
    expect(visibleName(moderator, 'Mai Anh')).toBeNull();
  });
});
