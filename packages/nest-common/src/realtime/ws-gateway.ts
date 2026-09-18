import { applyDecorators, Catch, Logger, UseFilters } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { WebSocketGateway, WsException } from '@nestjs/websockets';
import type { GatewayMetadata } from '@nestjs/websockets';
import { isErrorCode, SOCKET_EVENTS } from '@wayfare/contracts';
import type { ErrorCode } from '@wayfare/contracts';
import { isGrpcServiceError, readGrpcErrorInfo } from '../errors/grpc-service-error';
import { SOCKET_NAMESPACE } from './socket-emitter';

/** A refusal a socket handler raises: answered as `error { code }`, the socket kept. */
export class WsError extends WsException {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

/** The part of a socket the filter needs. */
interface ErrorTarget {
  emit(event: string, payload: unknown): unknown;
}

/** An exception's code: its own, a peer's, or `INTERNAL` for anything unexpected. */
export function wsErrorCode(exception: unknown): { code: ErrorCode; expected: boolean } {
  if (exception instanceof WsError) return { code: exception.code, expected: true };
  if (isGrpcServiceError(exception)) {
    const info = readGrpcErrorInfo(exception);
    if (info !== null && isErrorCode(info.code)) return { code: info.code, expected: true };
    if (exception.code === status.UNAVAILABLE)
      return { code: 'UPSTREAM_UNAVAILABLE', expected: true };
    if (exception.code === status.DEADLINE_EXCEEDED)
      return { code: 'UPSTREAM_TIMEOUT', expected: true };
  }
  return { code: 'INTERNAL', expected: false };
}

/**
 * Every socket handler's errors (api-endpoints-plan §9): emitted as `error { code }` with an
 * `ErrorCode`, never thrown away with the socket. The unexpected ones are logged.
 */
@Catch()
export class WsErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { code, expected } = wsErrorCode(exception);
    if (!expected) {
      this.logger.error(
        { err: exception instanceof Error ? exception.message : 'unknown' },
        'unexpected socket error',
      );
    }
    host.switchToWs().getClient<ErrorTarget>().emit(SOCKET_EVENTS.error, { code });
  }
}

/**
 * The one socket namespace (api-endpoints-plan §9, ADR 0020): `/ws`, WebSocket transport only —
 * set after the caller's options so they cannot unset it — and `WsErrorFilter`. CORS comes from
 * the adapter, which reads the same `CORS_ORIGINS` as HTTP.
 */
export function WayfareGateway(options: GatewayMetadata = {}): ClassDecorator {
  return applyDecorators(
    WebSocketGateway({ ...options, namespace: SOCKET_NAMESPACE, transports: ['websocket'] }),
    UseFilters(WsErrorFilter),
  );
}
