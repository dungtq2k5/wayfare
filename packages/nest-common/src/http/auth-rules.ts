import type { Reflector } from '@nestjs/core';
import type { RateLimitClass } from '@wayfare/contracts';
import { AUTH_RULE, RATE_LIMIT_CLASS, REQUIRED_PERMISSIONS } from './auth.decorators';
import type { AuthRule } from './auth.decorators';

/** A handler's effective rule: a marker, or a permission list (which implies an account). */
export type EffectiveAuth =
  | { readonly kind: 'marker'; readonly rule: AuthRule }
  | { readonly kind: 'permissions'; readonly codes: readonly string[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'both' };

/** A handler or controller, as Nest's `Reflector` reads them. */
type Target = Parameters<Reflector['get']>[1];

/** Reads the rule from the handler, then its controller. */
export function effectiveAuth(
  reflector: Reflector,
  handler: Target,
  controller: Target,
): EffectiveAuth {
  const rule = reflector.getAllAndOverride<AuthRule | undefined>(AUTH_RULE, [handler, controller]);
  const codes = reflector.getAllAndOverride<readonly string[] | undefined>(REQUIRED_PERMISSIONS, [
    handler,
    controller,
  ]);
  if (rule !== undefined && codes !== undefined) return { kind: 'both' };
  if (rule !== undefined) return { kind: 'marker', rule };
  if (codes !== undefined) return { kind: 'permissions', codes };
  return { kind: 'none' };
}

/** The rate-limit class each marker implies when the route names none (conventions §5.3). */
export const DEFAULT_RATE_LIMIT_CLASS: Readonly<Record<AuthRule['marker'], RateLimitClass | null>> =
  {
    PUBLIC: 'PUBLIC_READ',
    DEVICE: 'DEVICE_READ',
    USER: 'AUTHENTICATED',
    USER_EMAIL: 'AUTHENTICATED',
    OWNER: 'AUTHENTICATED',
    STAFF: 'AUTHENTICATED',
    SIGNATURE: null,
  };

/** The route's rate-limit class: its own `@RateLimit`, else its rule's default. */
export function effectiveRateLimitClass(
  reflector: Reflector,
  handler: Target,
  controller: Target,
  auth: EffectiveAuth,
): RateLimitClass | null {
  const explicit = reflector.getAllAndOverride<RateLimitClass | null | undefined>(
    RATE_LIMIT_CLASS,
    [handler, controller],
  );
  if (explicit !== undefined) return explicit;
  if (auth.kind === 'marker') return DEFAULT_RATE_LIMIT_CLASS[auth.rule.marker];
  if (auth.kind === 'permissions') return 'AUTHENTICATED';
  return null;
}
