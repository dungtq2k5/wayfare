import { LEGAL_DOCUMENT_VERSIONS, OwnerRegistrationStatus } from '@wayfare/contracts';
import type { OwnerRegistration } from '@wayfare/contracts';
import { formatPhone, toE164 } from '../i18n/format';

/** What the form holds; the national ID only until it is sent (K2). */
export interface Answers {
  businessName: string;
  businessAddress: string;
  businessRegistrationNo: string;
  contactName: string;
  contactPhone: string;
  nationalId: string;
  applicantNote: string;
}

/**
 * The form's first answers (K2): applying again after a rejection or a withdrawal starts from the
 * latest application — every answer but the national ID, which is always typed again.
 */
export function initialAnswers(latest: OwnerRegistration | null): Answers {
  const again =
    latest !== null &&
    (latest.status === OwnerRegistrationStatus.REJECTED ||
      latest.status === OwnerRegistrationStatus.WITHDRAWN);
  return {
    businessName: again ? latest.businessName : '',
    businessAddress: again ? latest.businessAddress : '',
    businessRegistrationNo: again ? (latest.businessRegistrationNo ?? '') : '',
    contactName: again ? latest.contactName : '',
    contactPhone: again ? formatPhone(latest.contactPhone) : '',
    nationalId: '',
    applicantNote: again ? (latest.applicantNote ?? '') : '',
  };
}

/** The body sent: blanks optional fields leave out, the phone in E.164. */
export function registrationValues(answers: Answers): Record<string, unknown> {
  const optional = (value: string) => (value.trim() === '' ? undefined : value);
  return {
    businessName: answers.businessName,
    businessAddress: answers.businessAddress,
    businessRegistrationNo: optional(answers.businessRegistrationNo),
    contactName: answers.contactName,
    contactPhone: answers.contactPhone.trim() === '' ? '' : toE164(answers.contactPhone),
    nationalId: answers.nationalId,
    applicantNote: optional(answers.applicantNote),
    ownerAgreementVersion: LEGAL_DOCUMENT_VERSIONS.OWNER_AGREEMENT,
  };
}
