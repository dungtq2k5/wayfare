import { z } from 'zod';
import { MAX_DECISION_NOTE_LENGTH } from '../catalog/limits';
import { zPhone } from '../catalog/schemas';
import { zUuidV7 } from '../common/ids';
import { zPageQuery } from '../common/pagination';
import { normalizeText } from '../common/text';
import { OwnerRegistrationStatus } from './enums';
import {
  MAX_BUSINESS_ADDRESS_LENGTH,
  MAX_BUSINESS_NAME_LENGTH,
  MAX_BUSINESS_REGISTRATION_NO_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  MAX_REGISTRATION_NOTE_LENGTH,
} from './limits';

const zInstant = z.iso.datetime({ offset: true });

/** User text, normalized before its bounds are checked (conventions §11.1). */
const zText = (max: number, options: { singleLine?: boolean } = {}) =>
  z
    .string()
    .transform(normalizeText)
    .pipe(
      options.singleLine === true
        ? z
            .string()
            .min(1)
            .max(max)
            .regex(/^[^\n]*$/)
        : z.string().min(1).max(max),
    );

/**
 * A CCCD number: exactly 12 digits once spaces are stripped (rdm-spec I-8,
 * api-endpoints-plan §1.4). Never logged, never echoed.
 */
export const zNationalId = z
  .string()
  .max(32)
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{12}$/, { message: 'Expected 12 digits' }));

/** `POST /owner/registration` body (api-endpoints-plan §1.4). */
export const zOwnerRegistrationInput = z
  .object({
    businessName: zText(MAX_BUSINESS_NAME_LENGTH, { singleLine: true }),
    businessAddress: zText(MAX_BUSINESS_ADDRESS_LENGTH, { singleLine: true }),
    businessRegistrationNo: zText(MAX_BUSINESS_REGISTRATION_NO_LENGTH, {
      singleLine: true,
    }).optional(),
    contactName: zText(MAX_CONTACT_NAME_LENGTH, { singleLine: true }),
    contactPhone: zPhone,
    nationalId: zNationalId,
    applicantNote: zText(MAX_REGISTRATION_NOTE_LENGTH).optional(),
    ownerAgreementVersion: z.string().min(1).max(MAX_POLICY_VERSION_LENGTH),
  })
  .strict();
/** A validated application. */
export type OwnerRegistrationInput = z.output<typeof zOwnerRegistrationInput>;

const registrationShape = {
  id: zUuidV7,
  status: z.enum(OwnerRegistrationStatus),
  businessName: z.string(),
  businessAddress: z.string(),
  businessRegistrationNo: z.string().nullable(),
  contactName: z.string(),
  contactPhone: z.string(),
  /** Null once redacted. */
  nationalIdLast4: z.string().nullable(),
  applicantNote: z.string().nullable(),
  decisionNote: z.string().nullable(),
  submittedAt: zInstant,
  reviewedAt: zInstant.nullable(),
};

/**
 * An application as its applicant sees it (api-endpoints-plan §1.4). It has no `internalNote` key
 * at all: the staff note has no field here to leak through (rdm-spec I-8).
 */
export const zOwnerRegistration = z.object(registrationShape).strict();
/** The applicant's view. */
export type OwnerRegistration = z.output<typeof zOwnerRegistration>;

/** A queue row (api-endpoints-plan §1.5): the application, its staff fields and who applied. */
export const zOwnerRegistrationAdminItem = z
  .object({
    ...registrationShape,
    internalNote: z.string().nullable(),
    reviewedById: zUuidV7.nullable(),
    piiRedacted: z.boolean(),
    applicant: z
      .object({ id: zUuidV7, email: z.string(), fullName: z.string().nullable() })
      .strict(),
  })
  .strict();
/** A queue row. */
export type OwnerRegistrationAdminItem = z.output<typeof zOwnerRegistrationAdminItem>;

/** The applicant's account, as the review detail shows it. */
export const zRegistrationApplicant = z
  .object({
    id: zUuidV7,
    email: z.string(),
    fullName: z.string().nullable(),
    createdAt: zInstant,
    emailVerified: z.boolean(),
    ownerVerified: z.boolean(),
    /** Locked right now: a lapsed lock reads `false`. */
    isLocked: z.boolean(),
    deactivated: z.boolean(),
  })
  .strict();

/** An earlier application by the same person: its status and dates only. */
export const zPriorRegistration = z
  .object({
    id: zUuidV7,
    status: z.enum(OwnerRegistrationStatus),
    submittedAt: zInstant,
    reviewedAt: zInstant.nullable(),
  })
  .strict();

/**
 * The review detail (api-endpoints-plan §1.5): the national ID as its last four only, the
 * applicant's account and their other applications, newest first.
 */
export const zOwnerRegistrationAdmin = zOwnerRegistrationAdminItem
  .extend({
    applicant: zRegistrationApplicant,
    priorApplications: z.array(zPriorRegistration),
  })
  .strict();
/** The review detail. */
export type OwnerRegistrationAdmin = z.output<typeof zOwnerRegistrationAdmin>;

/** `GET /admin/owner-registrations` query: `PENDING` by default, oldest first for `PENDING`. */
export const zOwnerRegistrationQueueQuery = zPageQuery({
  sort: ['submittedAt'],
  defaultSort: 'submittedAt',
  search: true,
})
  .omit({ sort: true })
  .extend({
    status: z.enum(OwnerRegistrationStatus).default(OwnerRegistrationStatus.PENDING),
  })
  .strict();

const zDecisionNoteInput = zText(MAX_DECISION_NOTE_LENGTH);
const zInternalNoteInput = zText(MAX_REGISTRATION_NOTE_LENGTH);

/** `POST /admin/owner-registrations/:id/approve` body (api-endpoints-plan §1.5). */
export const zApproveRegistrationInput = z
  .object({
    decisionNote: zDecisionNoteInput.optional(),
    internalNote: zInternalNoteInput.optional(),
  })
  .strict();

/** `POST /admin/owner-registrations/:id/reject` body: the applicant is always told why. */
export const zRejectRegistrationInput = z
  .object({
    decisionNote: zDecisionNoteInput,
    internalNote: zInternalNoteInput.optional(),
  })
  .strict();

/** `POST …/national-id/reveal`'s answer. */
export const zRevealedNationalId = z.object({ nationalId: z.string() }).strict();

/** `/users/me`'s `owner.pendingRegistration`: the caller's open application. */
export const zPendingRegistration = z.object({ id: zUuidV7, submittedAt: zInstant }).strict();
