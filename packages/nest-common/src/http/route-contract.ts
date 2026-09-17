import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { effectiveAuth } from './auth-rules';
import { STAFF_MEMBERSHIP_RESOLVER } from './auth.guard';
import type { StaffMembershipResolver } from './auth.guard';

/** Thrown at boot for an HTTP route that breaks the auth contract (conventions §5.3). */
export class RouteContractError extends Error {
  constructor(problems: readonly string[]) {
    super(`Route contract violated:\n  ${problems.join('\n  ')}`);
    this.name = 'RouteContractError';
  }
}

/**
 * Deny-by-default at boot (conventions §5.3): every HTTP handler carries exactly one auth rule, and
 * a `STAFF` route needs a registered membership resolver. Runs inside `app.init()` and `listen()`,
 * before the port opens.
 */
@Injectable()
export class RouteContractCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    @Optional() @Inject(STAFF_MEMBERSHIP_RESOLVER) private readonly staff?: StaffMembershipResolver,
  ) {}

  onApplicationBootstrap(): void {
    const problems = this.problems();
    if (problems.length > 0) throw new RouteContractError(problems);
  }

  /** Every violation, naming the controller and the method. */
  problems(): string[] {
    const problems: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const instance: unknown = wrapper.instance;
      const { metatype } = wrapper;
      if (!instance || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as (...args: never[]) => unknown;
        const isHttpRoute =
          Reflect.getMetadata(PATH_METADATA, handler) !== undefined &&
          Reflect.getMetadata(METHOD_METADATA, handler) !== undefined;
        if (!isHttpRoute) continue;
        const where = `${metatype.name}.${name}`;
        const auth = effectiveAuth(this.reflector, handler, metatype as never);
        if (auth.kind === 'none') problems.push(`${where} has no @Auth or @RequirePermission`);
        if (auth.kind === 'both') problems.push(`${where} has both @Auth and @RequirePermission`);
        if (auth.kind === 'marker' && auth.rule.marker === 'STAFF' && this.staff === undefined) {
          problems.push(`${where} uses STAFF, but no StaffMembershipResolver is registered`);
        }
      }
    }
    return problems;
  }
}
