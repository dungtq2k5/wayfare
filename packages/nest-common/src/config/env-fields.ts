import { z } from 'zod';

/** The runtime modes a service accepts in `NODE_ENV`. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;
/** A service's runtime mode. */
export type NodeEnv = (typeof NODE_ENVS)[number];

/** pino's levels, most to least severe. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
/** A pino log level. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** `NODE_ENV`, required — a service never guesses its mode. */
export const zNodeEnv = z.enum(NODE_ENVS);
/** `LOG_LEVEL`, `info` when unset. */
export const zLogLevel = z.enum(LOG_LEVELS).default('info');
/** A TCP port from an env string. */
export const zPort = z.coerce.number().int().min(1).max(65535);
