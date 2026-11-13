import { Injectable } from '@nestjs/common';
import type { BillingOwner } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';

/** A person as a read names them: `name` is `null` for a caller the names rule withholds it from. */
export interface NamedPerson {
  readonly id: string;
  readonly name: string | null;
}

/**
 * The names rule (api-endpoints-plan §0, the product owner): people's names reach only a caller
 * holding `user.read`. Everyone else reads `null`, and the console says "You" or "A staff member".
 */
export function seesNames(context: AccountContext): boolean {
  return context.permissions.includes('user.read');
}

/** A name identity joined into its own read, passed on by the rule. */
export function visibleName(context: AccountContext, name: string | undefined): string | null {
  return seesNames(context) ? (name ?? null) : null;
}

/** Each billing account's owner by id, from identity in one call (`PeopleNamesService.owners`). */
export type OwnerOf = (ownerUserId: string) => BillingOwner;

/** People's names for other services' reads (catalog's, narration's), resolved by the rule. */
@Injectable()
export class PeopleNamesService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  /**
   * The names of `ids`, one identity call for all of them; nothing is asked when the caller may
   * not see names. An erased or unknown person reads `null`.
   */
  async of(
    context: AccountContext,
    ids: readonly (string | null | undefined)[],
  ): Promise<(id: string) => NamedPerson> {
    const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
    if (!seesNames(context) || wanted.length === 0) return (id) => ({ id, name: null });
    const { users } = await this.identity.adminUsers.call(
      'getUserNames',
      { userIds: wanted },
      context,
    );
    const names = new Map(users.map((user) => [user.id, user.name ?? null]));
    return (id) => ({ id, name: names.get(id) ?? null });
  }

  /**
   * The owners of billing accounts, name and email, one identity call for all of them: always
   * shown, since the account is the owner's (not under the names rule, which covers staff). An
   * erased or unknown owner reads nulls.
   */
  async owners(
    context: AccountContext,
    ids: readonly (string | null | undefined)[],
  ): Promise<OwnerOf> {
    const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
    if (wanted.length === 0) return () => ({ name: null, email: null });
    const { users } = await this.identity.adminUsers.call(
      'getUserNames',
      { userIds: wanted },
      context,
    );
    const owners = new Map(
      users.map((user) => [user.id, { name: user.name ?? null, email: user.email ?? null }]),
    );
    return (id) => owners.get(id) ?? { name: null, email: null };
  }
}
