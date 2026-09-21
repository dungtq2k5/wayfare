import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zPageQuery } from '../common/pagination';
import { normalizeText } from '../common/text';
import { zEmail } from './email';
import { AccountRecoveryStatus, RECOVERY_EVIDENCE_CODES, RecoveryEvidenceCode } from './enums';
import { MAX_PASSWORD_LENGTH, MAX_SUPPORT_REFERENCE_LENGTH, MIN_PASSWORD_LENGTH } from './limits';

const zInstant = z.iso.datetime({ offset: true });

/** The ticket the request came through; there is no public "I lost access" form (rdm-spec I-14). */
const zSupportReference = z
  .string()
  .transform(normalizeText)
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_SUPPORT_REFERENCE_LENGTH)
      .regex(/^[^\n]*$/),
  );

/**
 * `POST /admin/users/:id/email-recoveries` body (api-endpoints-plan §1.10). The evidence travels
 * as codes only — never a phone number, card digits or invoice amounts (rdm-spec I-14).
 */
export const zOpenRecoveryInput = z
  .object({
    requestedEmail: zEmail,
    evidenceCodes: z
      .array(z.enum(RecoveryEvidenceCode))
      .min(1)
      .max(RECOVERY_EVIDENCE_CODES.length)
      .transform((codes) => [...new Set(codes)]),
    supportReference: zSupportReference,
  })
  .strict();
/** What opening a recovery states. */
export type OpenRecoveryInput = z.output<typeof zOpenRecoveryInput>;

/** A recovery as staff read it. The requested address is theirs to see; the owner's is not echoed. */
export const zRecovery = z
  .object({
    id: zUuidV7,
    userId: zUuidV7,
    status: z.enum(AccountRecoveryStatus),
    requestedEmail: z.string(),
    evidenceCodes: z.array(z.enum(RecoveryEvidenceCode)),
    supportReference: z.string(),
    openedById: zUuidV7,
    approvedById: zUuidV7.nullable(),
    decisionNote: z.string().nullable(),
    holdUntil: zInstant.nullable(),
    expiresAt: zInstant,
    completedAt: zInstant.nullable(),
    createdAt: zInstant,
    updatedAt: zInstant,
  })
  .strict();
/** One recovery case. */
export type Recovery = z.output<typeof zRecovery>;

/** `GET /admin/email-recoveries` query: every status by default, newest first. */
export const zRecoveryQuery = zPageQuery({
  sort: ['createdAt'],
  defaultSort: 'createdAt',
})
  .omit({ sort: true })
  .extend({ status: z.enum(AccountRecoveryStatus).optional() })
  .strict();
/** The staff queue's query. */
export type RecoveryQuery = z.output<typeof zRecoveryQuery>;

/** `POST /admin/email-recoveries/:id/reject` body: the note says why. */
export const zRejectRecoveryInput = z.object({ decisionNote: zSupportReference }).strict();

/**
 * `POST /account-recoveries/:id/cancel` body. The token comes from a hold notice; the case's own
 * owner, signed in, needs none (api-endpoints-plan §1.10).
 */
export const zCancelRecoveryInput = z.object({ token: z.string().min(1).optional() }).strict();

/**
 * `POST /account-recoveries/complete` body. The password travels with the token so the account is
 * never reachable by a reset to the new address in between (api-endpoints-plan §1.10).
 */
export const zCompleteRecoveryInput = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  })
  .strict();

/** What billing reads before letting an owner move money (api-endpoints-plan §12.2, ADR 0052). */
export const zSecurityState = z
  .object({
    /** While a live email-change revert could undo the address. */
    revertPendingUntil: zInstant.nullable(),
    /** When the password, address or sessions last changed — the payout cooldown's start. */
    credentialsChangedAt: zInstant.nullable(),
  })
  .strict();
/** An account's security state. */
export type SecurityState = z.output<typeof zSecurityState>;
