import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import type { JetStreamClient, JetStreamManager } from '@nats-io/jetstream';
import { connect, headers as natsHeaders } from '@nats-io/transport-node';
import type { NatsConnection } from '@nats-io/transport-node';
import type { EventPublisher } from '../outbox/outbox.relay';
import type { ReadinessCheck } from '../health/readiness';

/** One NATS connection per process, with its JetStream client and manager. */
export class NatsClient implements EventPublisher {
  private constructor(
    readonly connection: NatsConnection,
    readonly js: JetStreamClient,
    readonly jsm: JetStreamManager,
  ) {}

  /** Connects and prepares JetStream. Reconnects forever; readiness reports the gap. */
  static async connect(url: string, name: string): Promise<NatsClient> {
    const connection = await connect({ servers: url, name, maxReconnectAttempts: -1 });
    return new NatsClient(connection, jetstream(connection), await jetstreamManager(connection));
  }

  /** Publishes with `Nats-Msg-Id` for broker-side deduplication; resolves on the broker's ack. */
  async publish(
    subject: string,
    data: Uint8Array,
    options: { msgId?: string; headers: Record<string, string>; timeoutMs: number },
  ): Promise<void> {
    const bag = natsHeaders();
    for (const [key, value] of Object.entries(options.headers)) bag.set(key, value);
    await this.js.publish(subject, data, {
      ...(options.msgId === undefined ? {} : { msgID: options.msgId }),
      headers: bag,
      timeout: options.timeoutMs,
    });
  }

  /** Readiness: the connection is open and the server answers. */
  readinessCheck(): ReadinessCheck {
    return {
      name: 'nats',
      check: async () => {
        if (this.connection.isClosed()) throw new Error('connection closed');
        await this.connection.flush();
      },
    };
  }

  /** Drains subscriptions and closes the connection. */
  async close(): Promise<void> {
    if (!this.connection.isClosed()) await this.connection.drain();
  }
}
