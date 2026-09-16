import { RequestMethod } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

/** The pino-backed Nest logger; `app.useLogger(app.get(PinoLogger))`. */
export { Logger as PinoLogger } from 'nestjs-pino';
import type { Request } from 'express';
import type { LogLevel } from '../config/env-fields';
import { requestIdOfActiveTrace } from './trace';

/**
 * Paths pino redacts — a backstop, not the mechanism: secrets must never be logged in the first
 * place (conventions §9.4).
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.deviceSecret',
  '*.secret',
  '*.secretHash',
  '*.nationalId',
];

/** Options for `createLoggerModule`. */
export interface LoggerOptions {
  readonly level: LogLevel;
}

/** pino through nestjs-pino: JSON, trace ids on every line (via the OTel pino instrumentation). */
export function createLoggerModule(options: LoggerOptions): DynamicModule {
  return LoggerModule.forRoot({
    // Named wildcard: path-to-regexp v8 (Nest 11) rejects the bare '*' nestjs-pino defaults to.
    forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: options.level,
      redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
      genReqId: () => requestIdOfActiveTrace(),
      autoLogging: { ignore: (req) => /^\/(health|metrics)/.test((req as Request).url ?? '') },
    },
  });
}
