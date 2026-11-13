import { SESSION_CLIENT_BY_HEADER } from '@wayfare/contracts';
import type { WayfareClient } from '@wayfare/contracts';
import { sessionClientProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp } from '@wayfare/nest-common';
import { toUserResponseDto } from '../users/user.mapper';
import type { GatewaySession } from './auth.service';

/** The proto session client for the request's `X-Wayfare-Client`. */
export function toSessionClient(client: WayfareClient): identityGrpc.SessionClient {
  return sessionClientProto.toProto(SESSION_CLIENT_BY_HEADER[client]);
}

/** An opened or rotated session, its instants as `Date`. */
export function toGatewaySession(session: identityGrpc.Session | undefined): GatewaySession {
  if (session === undefined) throw new Error('A session response arrived without its session');
  return {
    user: toUserResponseDto(session.user),
    accessToken: session.accessToken,
    accessExpiresAt: fromProtoTimestamp(session.accessExpiresAt, 'accessExpiresAt'),
    refreshToken: session.refreshToken,
    refreshExpiresAt: fromProtoTimestamp(session.refreshExpiresAt, 'refreshExpiresAt'),
  };
}
