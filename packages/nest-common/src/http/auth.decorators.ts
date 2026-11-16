import { applyDecorators, Header, SetMetadata } from '@nestjs/common';
import type { PermissionCode, RateLimitClass } from '@wayfare/contracts';

/** The auth rules of api-endpoints-plan §0.2. */
export type AuthMarker =
  'PUBLIC' | 'DEVICE' | 'USER' | 'USER_EMAIL' | 'OWNER' | 'STAFF' | 'SIGNATURE';

/** A route's `@Auth` rule. */
export interface AuthRule {
  readonly marker: AuthMarker;
  /** api's `USER + DEVICE`: the account must also carry a device. */
  readonly alsoDevice: boolean;
  /** A public route that reads the refresh cookie — documented with that scheme. */
  readonly refreshCookie: boolean;
}

/** Options for `@Auth`. */
export interface AuthOptions {
  readonly alsoDevice?: boolean;
  readonly refreshCookie?: boolean;
}

/** Metadata keys, read by the guards, the boot check and the Swagger post-pass. */
export const AUTH_RULE = 'wayfare:auth-rule';
export const REQUIRED_PERMISSIONS = 'wayfare:required-permissions';
export const RATE_LIMIT_CLASS = 'wayfare:rate-limit-class';
export const APP_VERSION_FROM_BODY = 'wayfare:app-version-from-body';
export const USES_UPSTREAM = 'wayfare:uses-upstream';

/**
 * The route's auth rule (api-endpoints-plan §0.2, conventions §5.3). Every route carries exactly one
 * rule — this, or `@RequirePermission` — or the gateway refuses to boot.
 */
export function Auth(
  marker: AuthMarker,
  options: AuthOptions = {},
): MethodDecorator & ClassDecorator {
  const rule: AuthRule = {
    marker,
    alsoDevice: options.alsoDevice ?? false,
    refreshCookie: options.refreshCookie ?? false,
  };
  return SetMetadata(AUTH_RULE, rule);
}

/**
 * Admits an account holding **any** of the codes (api-endpoints-plan §11); implies `USER`. A tuple
 * type, so an empty call — which would read as "no permission required" — does not compile.
 */
export function RequirePermission(
  ...codes: [PermissionCode, ...PermissionCode[]]
): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_PERMISSIONS, codes);
}

/**
 * The route's rate-limit class (api-endpoints-plan §0.9); without it the marker's default applies.
 * `null` means never counted — probes and provider webhooks.
 */
export function RateLimit(cls: RateLimitClass | null): MethodDecorator & ClassDecorator {
  return SetMetadata(RATE_LIMIT_CLASS, cls);
}

/** Judges a `mobile` request's build by this body field instead of the header (`POST /devices`). */
export function AppVersionFromBody(field: string): MethodDecorator & ClassDecorator {
  return SetMetadata(APP_VERSION_FROM_BODY, field);
}

/** Marks a controller whose routes call a gRPC peer, so they document the upstream errors. */
export function UsesUpstream(): ClassDecorator {
  return SetMetadata(USES_UPSTREAM, true);
}

/** Account-specific responses are never cached (api-endpoints-plan §0.7). */
export function NoStore(): MethodDecorator {
  return applyDecorators(Header('Cache-Control', 'private, no-store'));
}
