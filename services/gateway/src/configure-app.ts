import { RequestMethod, VersioningType } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_VERSION_HEADER } from '@wayfare/contracts';
import {
  AccountTokenVerifier,
  createRequestContextMiddleware,
  ErrorFilter,
  ETagInterceptor,
  isProductionEnv,
  ResponseEnvelopeInterceptor,
  ResponseValidationInterceptor,
  securityHeaders,
  setupSwagger,
} from '@wayfare/nest-common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Env as GatewayEnv, GatewayConfig } from './config/env.schema';

/** Routes outside the global prefix: probes and the printed QR URL (ADR 0057). */
export const UNPREFIXED_ROUTES = [
  'health',
  'health/ready',
  'version',
  { path: 'q/:publicCode', method: RequestMethod.GET },
];

/** The title and version the OpenAPI document carries, served and emitted alike. */
export function openApiOptions(config: GatewayConfig): { title: string; version: string } {
  return { title: 'Wayfare API', version: config.get('APP_VERSION', { infer: true }) };
}

/**
 * The HTTP pipeline, in order. Shared by `main.ts` and the e2e suite so tests exercise exactly
 * what production runs. The order is part of the contract.
 */
export function configureApp(app: NestExpressApplication, config: GatewayConfig): void {
  const read = <K extends keyof GatewayEnv>(key: K) => config.get(key, { infer: true });
  const isProduction = isProductionEnv(read('NODE_ENV'));

  app.set('trust proxy', read('TRUST_PROXY_HOPS')); // exact hop count; 0 locally
  app.setGlobalPrefix(read('GLOBAL_PREFIX'), { exclude: UNPREFIXED_ROUTES });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(securityHeaders()); // strict CSP everywhere, Swagger UI's policy under /docs only
  // Resolves the caller once — tokens verified, revocation checked — before any guard (conventions §4.1).
  app.use(createRequestContextMiddleware(app.get(AccountTokenVerifier)));
  app.enableCors({
    origin: read('CORS_ORIGINS'),
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Wayfare-Client',
      APP_VERSION_HEADER,
      'Idempotency-Key',
    ],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalInterceptors(
    // Registered FIRST = runs LAST on the way out: validation sees the handler's raw value,
    // and only then does the envelope wrap it.
    new ResponseEnvelopeInterceptor(app.get(Reflector)),
    new ResponseValidationInterceptor(app.get(Reflector), isProduction),
    // Registered LAST = runs FIRST on the way out: a matching If-None-Match becomes a 304
    // before validation and the envelope see anything.
    new ETagInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new ErrorFilter(isProduction));
  if (read('SWAGGER_ENABLED')) setupSwagger(app, openApiOptions(config));
  app.enableShutdownHooks();
}
