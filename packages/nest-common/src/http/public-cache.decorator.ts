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
