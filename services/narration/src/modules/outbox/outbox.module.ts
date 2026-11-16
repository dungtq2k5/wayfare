import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import {
  ConsumerRunner,
  ensureStreams,
  NatsClient,
  OutboxRelay,
  OutboxService,
} from '@wayfare/nest-common';
import type { JetStreamConsumer } from '@wayfare/nest-common';
import type { StreamName } from '@wayfare/contracts';
import { ConfigService } from '@nestjs/config';
import type { NarrationConfig } from '../../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';

/** The service name used in durable names and dead-letter subjects. */
export const SERVICE_NAME = 'narration';

/**
 * Streams narration declares at boot: every stream it publishes to — its own, the audit subject,
 * the dead letters — and catalog's, which it consumes (api-endpoints-plan §10). `ensureStreams`
 * creates a missing one and verifies an existing one.
 */
export const NARRATION_STREAMS: readonly StreamName[] = ['NARRATION', 'CATALOG', 'AUDIT', 'DLQ'];

/** Injection token for the consumers this service runs. */
export const CONSUMERS = Symbol('CONSUMERS');

/**
 * Starts and stops the event spine: streams, the outbox relay and the consumers.
 * `main.ts` calls `start()` after the app is listening.
 */
@Injectable()
export class EventSpine implements OnApplicationShutdown {
  private started = false;

  constructor(
    private readonly nats: NatsClient,
    private readonly relay: OutboxRelay,
    private readonly runner: ConsumerRunner,
    @Inject(CONSUMERS) private readonly consumers: JetStreamConsumer[],
  ) {}

  /** Declares the streams this service touches. Called before the microservice starts. */
  ensureStreams(): Promise<void> {
    return ensureStreams(this.nats.jsm, NARRATION_STREAMS);
  }

  /** Starts the relay and every consumer. */
  async start(): Promise<void> {
    this.relay.start();
    await this.runner.start(this.consumers);
    this.started = true;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.started) {
      await this.runner.stop();
      await this.relay.stop();
    }
    await this.nats.close();
  }
}

/** Outbox writing and relaying, plus the process's NATS connection (ADR 0039). */
@Global()
@Module({
  providers: [
    { provide: OutboxService, useValue: new OutboxService() },
    {
      provide: NatsClient,
      inject: [ConfigService],
      useFactory: (config: NarrationConfig) =>
        NatsClient.connect(config.get('NATS_URL', { infer: true }), SERVICE_NAME),
    },
    {
      provide: OutboxRelay,
      inject: [PrismaService, NatsClient],
      useFactory: (prisma: PrismaService, nats: NatsClient) => new OutboxRelay(prisma, nats),
    },
    {
      provide: ConsumerRunner,
      inject: [NatsClient],
      useFactory: (nats: NatsClient) => new ConsumerRunner(nats),
    },
  ],
  exports: [OutboxService, NatsClient, OutboxRelay, ConsumerRunner],
})
export class OutboxModule {}
