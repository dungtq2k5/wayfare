import pino from 'pino';
import type { Logger } from 'pino';
import { LOG_LEVELS } from '../config/env-fields';
import { LOG_REDACT_PATHS } from './logger';

/** What the warning logger writes with: pino's `info` and `warn`, so a spec can stand in for it. */
export type WarningSink = Pick<Logger, 'info' | 'warn'>;

/**
 * Everything `installWarningLogger` reads, as parameters. The process's own `execArgv` and
 * deprecation switches are the defaults; the environment is passed in by `instrumentation.ts`, the
 * file allowed to read `process.env` (conventions §13).
 */
export interface WarningLoggerOptions {
  readonly logger?: WarningSink;
  readonly execArgv?: readonly string[];
  readonly nodeOptions?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly noDeprecation?: boolean | undefined;
  readonly traceDeprecation?: boolean | undefined;
}

/** `NODE_OPTIONS` as the words Node reads from it: whitespace-separated, with "double" or 'single' quotes. */
function wordsOf(nodeOptions: string | undefined): string[] {
  if (nodeOptions === undefined) return [];
  return [...nodeOptions.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

/** Every value of a flag given as `--flag=X` or `--flag X`. */
function flagValues(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  args.forEach((arg, index) => {
    if (arg.startsWith(`${flag}=`)) values.push(arg.slice(flag.length + 1));
    else if (arg === flag && args[index + 1] !== undefined) values.push(args[index + 1]!);
  });
  return values;
}

/**
 * The one warning a running service meets by design: `@google-cloud/storage`'s request stream
 * (teeny-request) puts more than ten listeners on one short-lived `PassThrough` per call. Measured
 * not to be a leak (conventions §17.2). The match and the version below are revisited whenever
 * `@google-cloud/storage` is upgraded.
 */
const isKnown = (warning: Error): boolean =>
  warning.name === 'MaxListenersExceededWarning' && warning.message.includes('[PassThrough]');
const KNOWN_DEPENDENCY = 'teeny-request@11.0.1';
const KNOWN_REASON =
  "@google-cloud/storage's request stream adds more than ten listeners to one short-lived stream per call; measured not to be a leak (conventions §17.2). Logged once per process.";

/**
 * Sends every process warning through the service's structured logger (conventions §14.1)
 * instead of Node's plain-text printer, honouring the flags that printer honours: `--no-warnings`
 * and `NODE_NO_WARNINGS=1` (nothing is logged), `--no-deprecation`, `--disable-warning=<name or
 * code>`, `--trace-warnings` and `--trace-deprecation`. Installed from each service's
 * `instrumentation.ts`, the first thing `main.ts` imports. Returns a function that puts Node's own
 * printer back (for a spec).
 */
export function installWarningLogger(options: WarningLoggerOptions = {}): () => void {
  const env = options.env ?? {};
  const args = [
    ...(options.execArgv ?? process.execArgv),
    ...wordsOf(options.nodeOptions ?? env.NODE_OPTIONS),
  ];
  const level = LOG_LEVELS.find((candidate) => candidate === env.LOG_LEVEL) ?? 'info';
  const logger: WarningSink =
    options.logger ?? pino({ level, redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' } });
  const noDeprecation = options.noDeprecation ?? process.noDeprecation;
  const traceDeprecation = options.traceDeprecation ?? process.traceDeprecation;
  const silent = args.includes('--no-warnings') || env.NODE_NO_WARNINGS === '1';
  const disabled = flagValues(args, '--disable-warning');
  const traceWarnings = args.includes('--trace-warnings');
  let knownLogged = false;

  const listener = (warning: Error & { code?: string }): void => {
    const deprecation = warning.name === 'DeprecationWarning';
    if (deprecation && noDeprecation === true) return;
    if (disabled.some((value) => value === warning.name || value === warning.code)) return;
    if (isKnown(warning)) {
      if (knownLogged) return;
      knownLogged = true;
      logger.info(
        { name: warning.name, dependency: KNOWN_DEPENDENCY, reason: KNOWN_REASON },
        warning.message,
      );
      return;
    }
    const stack = traceWarnings || (deprecation && traceDeprecation === true);
    logger.warn(
      {
        name: warning.name,
        ...(warning.code === undefined ? {} : { code: warning.code }),
        ...(stack ? { stack: warning.stack } : {}),
      },
      warning.message,
    );
  };

  // Node's own printer is the one listener present at this point.
  const replaced = process.listeners('warning').filter((fn) => fn.name === 'onWarning');
  for (const fn of replaced) process.off('warning', fn);
  if (!silent) process.on('warning', listener);
  return () => {
    process.off('warning', listener);
    for (const fn of replaced) process.on('warning', fn);
  };
}
