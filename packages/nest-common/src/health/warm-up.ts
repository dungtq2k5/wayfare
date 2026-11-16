import { Logger } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import { toErrorMessage } from '../errors/poison-message';
import { packCallerContext } from '../grpc/caller-context';
import { SYSTEM_ORIGIN } from '../context/request-context';
import type { AccountContext, AnonymousContext, DeviceContext } from '../context/request-context';

/** One hot read, run once at boot. */
export interface WarmUpStep {
  readonly name: string;
  run(): Promise<unknown>;
}

/** An id no row has: a read for it still builds, compiles and runs its queries. */
export const WARM_UP_ID = '00000000-0000-7000-8000-000000000000';

/** The caller of a warm-up read: no one, as the gateway would pack it. */
export const warmUpAnonymous = (): Metadata =>
  packCallerContext({ kind: 'anonymous', origin: SYSTEM_ORIGIN } satisfies AnonymousContext);

/** A phone that doesn't exist: the tourist reads that need a device. */
export const warmUpDevice = (): Metadata =>
  packCallerContext({
    kind: 'device',
    deviceId: WARM_UP_ID,
    origin: SYSTEM_ORIGIN,
  } satisfies DeviceContext);

/** An account (by default one that doesn't exist), with every flag a hot read checks first. */
export const warmUpAccount = (
  permissions: readonly string[] = [],
  userId: string = WARM_UP_ID,
): Metadata =>
  packCallerContext({
    kind: 'account',
    userId,
    sessionId: WARM_UP_ID,
    deviceId: null,
    permissions,
    ownerVerified: true,
    emailVerified: true,
    origin: SYSTEM_ORIGIN,
  } satisfies AccountContext);

/**
 * Runs each hot read once, through the service's own gRPC controllers, before the service listens:
 * a cold process pays for each query shape's first run — Prisma compiling it, V8 compiling the
 * path — and on a starved CPU that first call alone passed the gateway's 2 s deadline. Called
 * before `startAllMicroservices` and `listen`, so neither gRPC nor `/health/ready` answers until
 * it is done. A step's error is expected (nothing to find on a fresh database) and never stops
 * the boot: the queries ran either way.
 */
export async function warmUp(steps: readonly WarmUpStep[]): Promise<void> {
  const logger = new Logger('WarmUp');
  const started = performance.now();
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      logger.debug(`${step.name}: ${toErrorMessage(error)}`);
    }
  }
  logger.log(`${steps.length} hot reads warmed in ${Math.round(performance.now() - started)} ms`);
}
