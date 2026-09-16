import './instrumentation'; // FIRST: tracing patches http and grpc before they load
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger, ShutdownRegistry, startMetricsServer } from '@wayfare/nest-common';
import { shutdownTracing } from '@wayfare/nest-common/instrumentation';
import { AppModule } from './app.module';
import { loadConfig } from './config/env.schema';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    rawBody: true, // provider webhooks verify signatures over the raw body
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  configureApp(app, config);

  const shutdown = app.get(ShutdownRegistry);
  shutdown.add(shutdownTracing); // registered first, so it runs last and flushes every span
  const metrics = await startMetricsServer(config.METRICS_PORT); // before the public listener
  shutdown.add(() => new Promise<void>((resolve) => metrics.close(() => resolve())));
  await app.listen(config.PORT);
}

void bootstrap().catch((error: unknown) => {
  console.error('gateway failed to start', error);
  process.exit(1);
});
