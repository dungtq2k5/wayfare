import './instrumentation'; // FIRST: tracing patches pg, grpc and http before they load
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import {
  GRPC_LOADER_OPTIONS,
  PinoLogger,
  protoPaths,
  ShutdownRegistry,
  startMetricsServer,
} from '@wayfare/nest-common';
import { shutdownTracing } from '@wayfare/nest-common/instrumentation';
import { AppModule } from './app.module';
import type { CatalogConfig } from './config/env.schema';
import { EventSpine } from './modules/outbox/outbox.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule.forRoot(), {
    bufferLogs: true,
    // A configuration error is thrown from here: rethrown to the catch below (exit 1), never an abort.
    abortOnError: false,
  });
  const config = app.get<CatalogConfig>(ConfigService);
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  // Read into a local: inside the union-typed options, `get`'s return type would be inferred as any.
  const grpcUrl = config.get('GRPC_URL', { infer: true });
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: [GRPC_PACKAGES.catalog, GRPC_PACKAGES.health],
      protoPath: protoPaths('catalog', 'health'),
      url: grpcUrl,
      loader: GRPC_LOADER_OPTIONS,
    },
  });

  // Both publishers and consumers declare their streams: a publish no stream captures is lost.
  const spine = app.get(EventSpine);
  await spine.ensureStreams();

  const shutdown = app.get(ShutdownRegistry);
  shutdown.add(shutdownTracing); // registered first, so it runs last and flushes every span
  const metrics = await startMetricsServer(config.get('METRICS_PORT', { infer: true }));
  shutdown.add(() => new Promise<void>((resolve) => metrics.close(() => resolve())));
  await app.startAllMicroservices();
  await app.listen(config.get('OPS_PORT', { infer: true }));
  new Logger('Bootstrap').log(`catalog listening on gRPC ${grpcUrl}, ops ${await app.getUrl()}`);
  await spine.start();
}

void bootstrap().catch((error: unknown) => {
  console.error('catalog failed to start', error);
  process.exit(1);
});
