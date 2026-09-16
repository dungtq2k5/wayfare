import './instrumentation'; // FIRST: tracing patches pg, grpc and http before they load
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
import { loadConfig } from './config/env.schema';
import { EventSpine } from './modules/outbox/outbox.module';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: [GRPC_PACKAGES.identity, GRPC_PACKAGES.health],
      protoPath: protoPaths('identity', 'health'),
      url: config.GRPC_URL,
      loader: GRPC_LOADER_OPTIONS,
    },
  });

  // Both publishers and consumers declare their streams: a publish no stream captures is lost.
  const spine = app.get(EventSpine);
  await spine.ensureStreams();

  const shutdown = app.get(ShutdownRegistry);
  shutdown.add(shutdownTracing); // registered first, so it runs last and flushes every span
  const metrics = await startMetricsServer(config.METRICS_PORT);
  shutdown.add(() => new Promise<void>((resolve) => metrics.close(() => resolve())));
  await app.startAllMicroservices();
  await app.listen(config.OPS_PORT);
  await spine.start();
}

void bootstrap().catch((error: unknown) => {
  console.error('identity failed to start', error);
  process.exit(1);
});
