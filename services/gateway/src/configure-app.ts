import { VersioningType } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ErrorFilter,
  requestContextMiddleware,
  ResponseEnvelopeInterceptor,
  ResponseValidationInterceptor,
  securityHeaders,
  setupSwagger,
} from '@wayfare/nest-common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { AppConfig } from './config/env.schema';

/** Routes outside the global prefix: probes and, later, the printed QR URL (ADR 0057). */
export const UNPREFIXED_ROUTES = ['health', 'health/ready', 'version'];

/**
 * The HTTP pipeline, in order. Shared by `main.ts` and the e2e suite so tests exercise exactly
 * what production runs. The order is part of the contract.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.set('trust proxy', config.TRUST_PROXY_HOPS); // exact hop count; 0 locally
  app.setGlobalPrefix(config.GLOBAL_PREFIX, { exclude: UNPREFIXED_ROUTES });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(securityHeaders()); // strict CSP everywhere, Swagger UI's policy under /docs only
  app.use(requestContextMiddleware); // resolves the caller once, for @Ctx()
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Wayfare-Client', 'Idempotency-Key'],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalInterceptors(
    // Registered FIRST = runs LAST on the way out: validation sees the handler's raw value,
    // and only then does the envelope wrap it.
    new ResponseEnvelopeInterceptor(app.get(Reflector)),
    new ResponseValidationInterceptor(app.get(Reflector), config.isProduction),
  );
  app.useGlobalFilters(new ErrorFilter(config.isProduction));
  if (config.SWAGGER_ENABLED)
    setupSwagger(app, { title: 'Wayfare API', version: config.APP_VERSION });
  app.enableShutdownHooks();
}
