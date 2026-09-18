import { Logger } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import { SOCKET_EVENTS, SOCKET_PAYLOADS } from '@wayfare/contracts';
import type { SocketEventKey, SocketPayload } from '@wayfare/contracts';

/** The namespace the gateway serves (api-endpoints-plan §9). */
export const SOCKET_NAMESPACE = '/ws';

/** Where frames go: a Redis client the gateway's adapter reads, or a test's collector. */
export interface FramePublisher {
  publish(channel: string, message: string | Buffer): unknown;
}

/**
 * Sends socket frames from a service with no socket server (conventions §7.4): through
 * `@socket.io/redis-emitter` on the Redis the gateway's adapter reads. Every payload is validated
 * with `SOCKET_PAYLOADS` first. Fire-and-forget: a frame is only the fast path, never the record.
 */
export class SocketEmitter {
  private readonly logger = new Logger(SocketEmitter.name);
  private readonly emitter: Emitter;

  constructor(redis: FramePublisher) {
    // The emitter never awaits a publish: a rejection (Redis offline) is caught here, not left unhandled.
    const publisher: FramePublisher = {
      publish: (channel, message) => {
        const sent = redis.publish(channel, message);
        if (sent instanceof Promise) {
          sent.catch((error: unknown) =>
            this.logger.warn(
              { err: error instanceof Error ? error.message : 'unknown' },
              'frame lost',
            ),
          );
        }
        return sent;
      },
    };
    this.emitter = new Emitter(publisher).of(SOCKET_NAMESPACE);
  }

  toRoom<K extends SocketEventKey>(
    room: string | readonly string[],
    event: K,
    payload: SocketPayload<K>,
  ): void {
    const checked = SOCKET_PAYLOADS[event].safeParse(payload);
    if (!checked.success) {
      this.logger.error(
        { event, issues: checked.error.issues.length },
        'invalid socket frame dropped',
      );
      return;
    }
    try {
      this.emitter
        .to([...(typeof room === 'string' ? [room] : room)])
        .emit(SOCKET_EVENTS[event], checked.data);
    } catch (error) {
      this.logger.warn(
        { event, err: error instanceof Error ? error.message : 'unknown' },
        'frame lost',
      );
    }
  }
}
