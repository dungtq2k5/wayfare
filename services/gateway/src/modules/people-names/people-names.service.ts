import { Injectable } from '@nestjs/common';
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
}
