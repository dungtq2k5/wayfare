import './instrumentation'; // FIRST: tracing patches http and grpc before they load
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger, ShutdownRegistry, startMetricsServer } from '@wayfare/nest-common';
import { shutdownTracing } from '@wayfare/nest-common/instrumentation';
import { AppModule } from './app.module';
import type { GatewayConfig } from './config/env.schema';
import { configureApp } from './configure-app';
import { RedisIoAdapter } from './redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(), {
    // A configuration error is thrown from here: rethrown to the catch below (exit 1), never an abort.
    abortOnError: false,
    rawBody: true, // provider webhooks verify signatures over the raw body
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  const config = app.get<GatewayConfig>(ConfigService);
  configureApp(app, config);

  const shutdown = app.get(ShutdownRegistry);
  shutdown.add(shutdownTracing); // registered first, so it runs last and flushes every span
  // The socket's Redis connections are open before the adapter serves a handshake (conventions §7.4).
  const io = new RedisIoAdapter(app, config.get('CORS_ORIGINS', { infer: true }));
  shutdown.add(await io.connect(config.get('REDIS_URL', { infer: true })));
  app.useWebSocketAdapter(io);
  const metrics = await startMetricsServer(config.get('METRICS_PORT', { infer: true })); // before the public listener
  shutdown.add(() => new Promise<void>((resolve) => metrics.close(() => resolve())));
  await app.listen(config.get('PORT', { infer: true }));
  // TODO Log an exposed endpoint for the sever, also for another services with Nestjs logger.
  // TODO Log Swagger exposed endpoint.
}

void bootstrap().catch((error: unknown) => {
  console.error('gateway failed to start', error);
  process.exit(1);
});
