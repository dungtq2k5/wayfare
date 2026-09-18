import { Inject, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { SOCKET_EVENTS, SOCKET_PAYLOADS, SOCKET_ROOMS } from '@wayfare/contracts';
import type { AccountClaims, ErrorCode } from '@wayfare/contracts';
import {
  ACCESS_COOKIE,
  AccountTokenVerifier,
  cookieFromHeader,
  WayfareGateway,
  WsError,
  wsErrorCode,
} from '@wayfare/nest-common';
import type { AccountContext, AccountTokenCheck } from '@wayfare/nest-common';
import type { Namespace, Socket } from 'socket.io';
import type { Env } from '../../config/env.schema';
import { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';

/** Injection token for the revalidation interval: `SOCKET_REVALIDATE_MS`, shorter in tests. */
export const SOCKET_REVALIDATE_INTERVAL = Symbol('SOCKET_REVALIDATE_INTERVAL');

/** The permission that opens the monitor's rooms. */
const MONITOR_PERMISSION = 'narration.job.read';

/** A connected, authenticated socket. */
interface Connection {
  readonly socket: Socket;
  readonly claims: AccountClaims;
  readonly expiry: NodeJS.Timeout;
}

/** The error a failed check answers with. */
const refusalOf = (check: AccountTokenCheck & { kind: 'rejected' }): ErrorCode =>
  check.error === 'unverifiable' ? 'UPSTREAM_UNAVAILABLE' : 'UNAUTHENTICATED';

/**
 * The socket (api-endpoints-plan §9): the console's live view. The handshake checks `Origin`, the
 * `console` client and the `wf_at` cookie; rooms are joined by the server only. Every socket is
 * revalidated on a timer, on each `job:subscribe`, and disconnected when its token expires — a
 * revoked or unverifiable token never keeps a socket (ADR 0020).
 */
@WayfareGateway()
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer() private readonly server!: Namespace;
  private readonly logger = new Logger(EventsGateway.name);
  private readonly connections = new Map<string, Connection>();
  private readonly corsOrigins: readonly string[];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly verifier: AccountTokenVerifier,
    private readonly narration: NarrationServiceGrpcClient,
    config: ConfigService<Env, true>,
    @Inject(SOCKET_REVALIDATE_INTERVAL) private readonly revalidateMs: number,
  ) {
    this.corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  }

  afterInit(): void {
    this.timer = setInterval(() => void this.revalidateAll(), this.revalidateMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    for (const connection of this.connections.values()) clearTimeout(connection.expiry);
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const claims = await this.authenticate(socket);
      await socket.join(SOCKET_ROOMS.user(claims.sub));
      if (claims.perms.includes(MONITOR_PERMISSION)) await socket.join(SOCKET_ROOMS.adminNarration);
      if (claims.ov) await socket.join(SOCKET_ROOMS.owner(claims.sub));
      const expiry = setTimeout(
        () => this.refuse(socket, 'UNAUTHENTICATED'),
        Math.max(0, claims.exp * 1000 - Date.now()),
      );
      expiry.unref();
      this.connections.set(socket.id, { socket, claims, expiry });
      socket.emit(SOCKET_EVENTS.connectionReady, {});
    } catch (error) {
      this.refuse(socket, wsErrorCode(error).code);
    }
  }

  handleDisconnect(socket: Socket): void {
    const connection = this.connections.get(socket.id);
    if (connection === undefined) return;
    clearTimeout(connection.expiry);
    this.connections.delete(socket.id);
  }

  @SubscribeMessage(SOCKET_EVENTS.jobSubscribe)
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    const connection = this.connections.get(socket.id);
    if (connection === undefined) throw new WsError('UNAUTHENTICATED');
    const payload = SOCKET_PAYLOADS.jobSubscribe.safeParse(body);
    if (!payload.success) throw new WsError('VALIDATION_FAILED');
    const check = await this.verifier.check(connection.claims);
    if (check.kind === 'rejected') {
      this.refuse(socket, refusalOf(check));
      return;
    }
    if (!connection.claims.perms.includes(MONITOR_PERMISSION))
      throw new WsError('PERMISSION_DENIED');
    // The job must exist; narration answers RESOURCE_NOT_FOUND otherwise.
    await this.narration.synthesisAdmin.call(
      'getJob',
      { jobId: payload.data.jobId },
      this.contextOf(connection),
    );
    await socket.join(SOCKET_ROOMS.job(payload.data.jobId));
    socket.emit(SOCKET_EVENTS.jobSubscribed, { jobId: payload.data.jobId });
  }

  @SubscribeMessage(SOCKET_EVENTS.jobUnsubscribe)
  async unsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const payload = SOCKET_PAYLOADS.jobUnsubscribe.safeParse(body);
    if (!payload.success) throw new WsError('VALIDATION_FAILED');
    await socket.leave(SOCKET_ROOMS.job(payload.data.jobId));
  }

  /** Re-checks every socket's token with one Redis read; the revoked and unverifiable are dropped. */
  async revalidateAll(): Promise<void> {
    const connections = [...this.connections.values()];
    if (connections.length === 0) return;
    try {
      const checks = await this.verifier.checkMany(
        connections.map((connection) => connection.claims),
      );
      for (const [index, check] of checks.entries()) {
        if (check.kind === 'rejected') this.refuse(connections[index]!.socket, refusalOf(check));
      }
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : 'unknown' },
        'revalidation failed',
      );
    }
  }

  /** The handshake's checks, in order (api-endpoints-plan §9). */
  private async authenticate(socket: Socket): Promise<AccountClaims> {
    const origin = socket.handshake.headers.origin;
    if (origin === undefined || !this.corsOrigins.includes(origin))
      throw new WsError('PERMISSION_DENIED');
    const auth = socket.handshake.auth as { client?: unknown } | undefined;
    if (auth?.client !== 'console') throw new WsError('CLIENT_HEADER_REQUIRED');
    const token = cookieFromHeader(socket.handshake.headers.cookie, ACCESS_COOKIE);
    const verified = token === null || token === '' ? null : this.verifier.verify(token);
    if (verified?.type !== 'account') throw new WsError('UNAUTHENTICATED');
    const check = await this.verifier.check(verified.claims);
    if (check.kind === 'rejected') throw new WsError(refusalOf(check));
    return check.claims;
  }

  /** Answers `error { code }`, then closes the socket. */
  private refuse(socket: Socket, code: ErrorCode): void {
    socket.emit(SOCKET_EVENTS.error, { code });
    socket.disconnect(true);
    this.handleDisconnect(socket);
  }

  private contextOf(connection: Connection): AccountContext {
    const { claims, socket } = connection;
    return {
      kind: 'account',
      userId: claims.sub,
      sessionId: claims.sid,
      deviceId: claims.did ?? null,
      permissions: claims.perms,
      ownerVerified: claims.ov,
      emailVerified: claims.ev,
      origin: {
        ip: socket.handshake.address || null,
        userAgent: socket.handshake.headers['user-agent']?.slice(0, 512) ?? null,
      },
    };
  }
}
