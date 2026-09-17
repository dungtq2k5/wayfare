import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_VERSION_HEADER, CLIENT_HEADER, NO_APP_VERSION_FLOOR } from '@wayfare/contracts';
import { AppHttpException } from './app-http.exception';
import { APP_VERSION_FROM_BODY } from './auth.decorators';
import { requestOf } from './request-of';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.+-]*)?$/;

/**
 * Compares two `MAJOR.MINOR.PATCH` versions, ignoring any pre-release or build suffix. `null` when
 * either is malformed.
 */
export function compareSemver(a: string, b: string): number | null {
  const left = SEMVER.exec(a);
  const right = SEMVER.exec(b);
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/**
 * Refuses a `mobile` build below `MIN_SUPPORTED_APP_VERSION` with `426` (api-endpoints-plan §0.3).
 * `POST /devices` is judged by its body; every other route by `X-Wayfare-App-Version`. A missing
 * or malformed version counts as below the floor. The default floor, `0.0.0`, switches the check
 * off entirely.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly minimumVersion: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.minimumVersion === NO_APP_VERSION_FLOOR || context.getType() !== 'http') return true;
    const request = requestOf(context);
    if (request.header(CLIENT_HEADER) !== 'mobile') return true;
    const field = this.reflector.getAllAndOverride<string | undefined>(APP_VERSION_FROM_BODY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const version =
      field === undefined
        ? request.header(APP_VERSION_HEADER)
        : (request.body as Record<string, unknown> | undefined)?.[field];
    const comparison =
      typeof version === 'string' ? compareSemver(version.trim(), this.minimumVersion) : null;
    if (comparison === null || comparison < 0) {
      throw new AppHttpException('APP_VERSION_UNSUPPORTED', {
        minimumVersion: this.minimumVersion,
      });
    }
    return true;
  }
}
