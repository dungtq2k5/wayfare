import { LegalDocument } from './enums';

/**
 * The current version of each legal document (api-endpoints-plan §1.3, rdm-spec I-12). A new
 * version ships with a deploy, as its text does; an acceptance of any other version is outdated.
 */
export const LEGAL_DOCUMENT_VERSIONS: Readonly<Record<LegalDocument, string>> = {
  [LegalDocument.TERMS_OF_SERVICE]: '2026-09-01',
  [LegalDocument.PRIVACY_POLICY]: '2026-09-01',
  [LegalDocument.OWNER_AGREEMENT]: '2026-09-01',
};

/** True when `version` is the current version of `document`. */
export function isCurrentLegalVersion(document: LegalDocument, version: string): boolean {
  return LEGAL_DOCUMENT_VERSIONS[document] === version;
}

/** Who accepted a legal document: an account, or an install (rdm-spec I-12). */
export enum LegalParty {
  USER = 'USER',
  DEVICE = 'DEVICE',
}

/** Every `LegalParty` value. */
export const LEGAL_PARTIES = Object.values(LegalParty);
