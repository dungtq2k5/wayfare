import { applyDecorators, Header, SetMetadata } from '@nestjs/common';

/** Metadata key: the route's public cache lifetime, in seconds. */
export const PUBLIC_CACHE = 'wayfare:public-cache';

/**
 * A public read a CDN may hold (api-endpoints-plan §2.1): `Cache-Control: public, max-age=<s>`.
 * The route-contract check refuses it on any route that is not `PUBLIC`.
 */
export function PublicCache(seconds: number): MethodDecorator {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new RangeError(`PublicCache: ${seconds} is not a positive whole number of seconds`);
  }
  return applyDecorators(
    SetMetadata(PUBLIC_CACHE, seconds),
    Header('Cache-Control', `public, max-age=${seconds}`),
  );
}

/** Metadata key: the route's private cache lifetime, in seconds. */
export const PRIVATE_CACHE = 'wayfare:private-cache';

/**
 * A short-lived read only the caller's own client may hold (api-endpoints-plan §4.1):
 * `Cache-Control: private, max-age=<s>`. The route-contract check refuses it on a `PUBLIC` route —
 * a response nobody authenticated for has no one to be private to.
 */
export function PrivateCache(seconds: number): MethodDecorator {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new RangeError(`PrivateCache: ${seconds} is not a positive whole number of seconds`);
  }
  return applyDecorators(
    SetMetadata(PRIVATE_CACHE, seconds),
    Header('Cache-Control', `private, max-age=${seconds}`),
  );
}
