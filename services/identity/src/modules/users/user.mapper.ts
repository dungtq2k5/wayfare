import { legalDocumentProto, legalPartyProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { LegalAcceptanceView } from '../legal/legal.service';
import type { SessionAccount } from '../sessions/sessions.service';

/** The account as every session and `GetMe` response carries it (api-endpoints-plan §1.3). */
export function toSessionUser(user: SessionAccount): identityGrpc.SessionUser {
  return {
    id: user.id,
    email: user.email,
    ...(user.fullName === null ? {} : { fullName: user.fullName }),
    preferredLocale: user.preferredLocale,
    isEmailVerified: user.isEmailVerified,
    emailBounced: user.emailBouncedAt !== null,
    createdAt: toProtoTimestamp(user.createdAt),
  };
}

/** One legal acceptance on the wire. */
export function toLegalAcceptance(view: LegalAcceptanceView): identityGrpc.LegalAcceptance {
  return {
    party: legalPartyProto.toProto(view.party),
    document: legalDocumentProto.toProto(view.document),
    version: view.version,
    acceptedAt: toProtoTimestamp(view.acceptedAt),
    current: view.current,
  };
}
