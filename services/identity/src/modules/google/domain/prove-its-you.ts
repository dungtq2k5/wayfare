import {
  MAX_GOOGLE_TOKEN_LENGTH,
  MAX_PASSWORD_LENGTH,
  PROOF_TOKEN_TYPES,
} from '@wayfare/contracts';
import { parseRpcRequest, rpcError } from '@wayfare/nest-common';
import { z } from 'zod';
import type { TokensService } from '../../tokens/tokens.service';

/** A protected route's body: exactly one of the current password and a Google confirmation. */
const proofFields = z
  .object({
    // proto3 sends an absent string as empty.
    currentPassword: z.string().max(MAX_PASSWORD_LENGTH).optional(),
    confirmation: z.string().max(MAX_GOOGLE_TOKEN_LENGTH).optional(),
  })
  .transform(({ currentPassword, confirmation }) => ({
    currentPassword: currentPassword === '' ? undefined : currentPassword,
    confirmation: confirmation === '' ? undefined : confirmation,
  }))
  .refine(
    ({ currentPassword, confirmation }) =>
      (currentPassword === undefined) !== (confirmation === undefined),
    { message: 'Exactly one of currentPassword and confirmation', path: ['currentPassword'] },
  );

/** The fields a protected request carries. */
export interface ProofRequest {
  readonly currentPassword?: string;
  readonly confirmation?: string;
}

/**
 * Where a route asks for the current password, a Google confirmation stands in for it (api §1.3):
 * issued by `GoogleConfirm` to this account and this session, minutes ago. A wrong password is
 * `wrongPassword`; a confirmation that is no longer good is `CONFIRMATION_EXPIRED`.
 */
export async function proveItsYou(
  tokens: TokensService,
  request: ProofRequest,
  account: {
    readonly userId: string;
    readonly sessionId: string;
    readonly passwordHash: string | null;
  },
  now: Date,
  /** The answer to a wrong password: erasure keeps its `INVALID_CREDENTIALS`. */
  wrongPassword:
    'CURRENT_PASSWORD_INCORRECT' | 'INVALID_CREDENTIALS' = 'CURRENT_PASSWORD_INCORRECT',
): Promise<void> {
  const { currentPassword, confirmation } = parseRpcRequest(proofFields, request);
  if (confirmation !== undefined) {
    const proof = tokens.verifyProof(PROOF_TOKEN_TYPES.googleConfirmation, confirmation, now);
    const ours =
      proof.ok && proof.claims.sub === account.userId && proof.claims.sid === account.sessionId;
    if (!ours) throw rpcError('CONFIRMATION_EXPIRED');
    return;
  }
  if (!(await tokens.verifyPassword(account.passwordHash, currentPassword ?? ''))) {
    throw rpcError(wrongPassword);
  }
}
