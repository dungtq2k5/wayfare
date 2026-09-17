import { Injectable } from '@nestjs/common';
import { ACTION_TOKEN_TTL_MS, ActionTokenPurpose, MAX_USER_AGENT_LENGTH } from '@wayfare/contracts';
import { generateToken, hashToken, rpcError } from '@wayfare/nest-common';
import type { RequestOrigin } from '@wayfare/nest-common';
import { Prisma } from '../../../generated/prisma/client';

/** A live action token, as consuming or inspecting it reads it. */
export interface ActionTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly purpose: ActionTokenPurpose;
  readonly targetEmail: string;
}

/** Purposes whose `target_email` is not the account's current address (rdm-spec I-9). */
const OFF_ADDRESS_PURPOSES = [
  ActionTokenPurpose.EMAIL_CHANGE,
  ActionTokenPurpose.EMAIL_CHANGE_REVERT,
] as const;

/**
 * The one liveness predicate (rdm-spec I-9): unused, not superseded, unexpired, of an allowed
 * purpose, for a live account, and — except for an address change or its revert — bound to the
 * address the account still has. A refused token was never live, so nothing rolls back wrongly.
 */
function livePredicate(purposes: readonly ActionTokenPurpose[]): Prisma.Sql {
  return Prisma.sql`
    t.used_at IS NULL AND t.invalidated_at IS NULL AND t.expires_at > now()
    AND t.purpose IN (${Prisma.join(purposes)})
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = t.user_id AND u.deleted_at IS NULL
        AND (t.purpose IN (${Prisma.join(OFF_ADDRESS_PURPOSES)}) OR u.email = t.target_email)
    )`;
}

interface RawTokenRow {
  id: string;
  user_id: string;
  purpose: ActionTokenPurpose;
  target_email: string;
}

const toRow = (raw: RawTokenRow): ActionTokenRow => ({
  id: raw.id,
  userId: raw.user_id,
  purpose: raw.purpose,
  targetEmail: raw.target_email,
});

/**
 * Single-use emailed links (rdm-spec I-9). The plaintext exists only in what `mint` returns and in
 * the one email that carries it; only its hash is stored.
 */
@Injectable()
export class AccountLinksService {
  /** Supersedes the user's live tokens of the purpose, and issues a new one bound to `targetEmail`. */
  async mint(
    tx: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly purpose: ActionTokenPurpose;
      readonly targetEmail: string;
      readonly origin: RequestOrigin;
      readonly now: Date;
    },
  ): Promise<{ id: string; token: string }> {
    await this.invalidate(tx, input.userId, [input.purpose], input.now);
    const token = generateToken();
    const row = await tx.actionToken.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        tokenHash: hashToken(token),
        targetEmail: input.targetEmail,
        expiresAt: new Date(input.now.getTime() + ACTION_TOKEN_TTL_MS[input.purpose]),
        ip: input.origin.ip,
        userAgent: input.origin.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, token };
  }

  /** The live token, read-only (validation before a form is shown), or `null`. */
  async inspect(
    db: Prisma.TransactionClient,
    token: string,
    purposes: readonly ActionTokenPurpose[],
  ): Promise<ActionTokenRow | null> {
    const rows = await db.$queryRaw<RawTokenRow[]>`
      SELECT t.id, t.user_id, t.purpose, t.target_email FROM action_tokens t
      WHERE t.token_hash = ${hashToken(token)} AND ${livePredicate(purposes)}`;
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  /**
   * Spends a live token in one conditional update; of two concurrent consumes exactly one wins.
   * Anything else is `410 TOKEN_EXPIRED`.
   */
  async consume(
    tx: Prisma.TransactionClient,
    token: string,
    purposes: readonly ActionTokenPurpose[],
  ): Promise<ActionTokenRow> {
    const rows = await tx.$queryRaw<RawTokenRow[]>`
      UPDATE action_tokens t SET used_at = now()
      WHERE t.token_hash = ${hashToken(token)} AND ${livePredicate(purposes)}
      RETURNING t.id, t.user_id, t.purpose, t.target_email`;
    if (rows[0] === undefined) throw rpcError('TOKEN_EXPIRED');
    return toRow(rows[0]);
  }

  /** Supersedes a user's outstanding tokens of the given purposes. */
  async invalidate(
    tx: Prisma.TransactionClient,
    userId: string,
    purposes: readonly ActionTokenPurpose[],
    now: Date,
  ): Promise<void> {
    await tx.actionToken.updateMany({
      where: {
        userId,
        purpose: { in: [...purposes] },
        usedAt: null,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
    });
  }

  /**
   * A live revert: for an address, one it reserves (so nobody may take it); for a user, one that
   * blocks their next address change (rdm-spec I-9).
   */
  async liveRevertFor(
    db: Prisma.TransactionClient,
    by: { readonly email: string } | { readonly userId: string },
  ): Promise<boolean> {
    const found = await db.actionToken.findFirst({
      where: {
        purpose: ActionTokenPurpose.EMAIL_CHANGE_REVERT,
        usedAt: null,
        invalidatedAt: null,
        expiresAt: { gt: new Date() },
        ...('email' in by ? { targetEmail: by.email } : { userId: by.userId }),
      },
      select: { id: true },
    });
    return found !== null;
  }
}
