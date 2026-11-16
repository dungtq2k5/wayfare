import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { OpenedSession } from '../sessions/sessions.service';
import { toSessionUser } from '../users/user.mapper';

/** An opened or rotated session on the wire; the gateway decides what reaches the client. */
export function toSession(session: OpenedSession): identityGrpc.Session {
  return {
    user: toSessionUser(session.user),
    accessToken: session.accessToken,
    accessExpiresAt: toProtoTimestamp(session.accessExpiresAt),
    refreshToken: session.refreshToken,
    refreshExpiresAt: toProtoTimestamp(session.refreshExpiresAt),
  };
}
