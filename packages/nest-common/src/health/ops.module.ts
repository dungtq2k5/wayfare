import { Controller, Get, HttpStatus, Inject, Module, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { DynamicModule, FactoryProvider, ModuleMetadata } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { GrpcHealthController } from '../grpc/grpc-health.controller';
import { Auth, RateLimit } from '../http/auth.decorators';
import { SkipClientHeader } from '../http/skip-client-header.decorator';
import { SkipEnvelope } from '../http/skip-envelope.decorator';
import { READINESS_CHECKS, ReadinessService } from './readiness';
import { ShutdownRegistry } from './shutdown-registry';
import type { ReadinessCheck, ReadinessReport } from './readiness';

/** What `/version` reports. */
export interface VersionInfo {
  readonly service: string;
  readonly version: string;
  readonly gitSha: string;
  readonly builtAt: string;
}

const VERSION_INFO = Symbol('VERSION_INFO');

/**
 * `/health`, `/health/ready`, `/version` (api-endpoints-plan §13). Version-neutral and exempt
 * from the client header: probes send neither a version nor custom headers. Served unwrapped, so
 * the body has one shape on every service. Public and never rate-limited — a probe behind a shared
 * load-balancer address must never be told 429. Excluded from the OpenAPI document — generated
 * clients never call probes — which is also what keeps these unwrapped routes out of the OpenAPI
 * contract suite's "one 2xx with `data`" rule.
 */
@ApiExcludeController()
@Auth('PUBLIC')
@RateLimit(null)
@Controller({ version: VERSION_NEUTRAL })
@SkipClientHeader()
@SkipEnvelope()
export class OpsController {
  constructor(
    private readonly readiness: ReadinessService,
    @Inject(VERSION_INFO) private readonly versionInfo: VersionInfo,
  ) {}

  /** Liveness: the process is up. Nothing else. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: this service's own dependencies — `503` when any is down. */
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessReport> {
    const report = await this.readiness.check();
    if (!report.ready) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      response.setHeader('Retry-After', '5');
    }
    return report;
  }

  @Get('version')
  version(): VersionInfo {
    return this.versionInfo;
  }
}

/** Options for `OpsModule.forRoot`. */
export interface OpsModuleOptions {
  readonly version: VersionInfo;
  /** Builds the service's readiness checks; `inject` tokens must come from `imports`. */
  readonly checks: Omit<FactoryProvider<ReadinessCheck[]>, 'provide'>;
  readonly imports?: ModuleMetadata['imports'];
  /** Also serve `grpc.health.v1.Health` — backend services only. */
  readonly grpcHealth?: boolean;
}

/** What `OpsModule.forRootAsync`'s factory returns. */
export interface OpsModuleValues {
  readonly version: VersionInfo;
  readonly checks: ReadinessCheck[];
}

/** Options for `OpsModule.forRootAsync`: one factory for the version and the readiness checks. */
export interface OpsModuleAsyncOptions {
  /** `inject` tokens must come from `imports` or be global (`ConfigService` is). */
  readonly inject: FactoryProvider<OpsModuleValues>['inject'];
  readonly useFactory: FactoryProvider<OpsModuleValues>['useFactory'];
  readonly imports?: ModuleMetadata['imports'];
  /** Also serve `grpc.health.v1.Health` — a static flag: a controller list cannot come from a factory. */
  readonly grpcHealth?: boolean;
}

const OPS_VALUES = Symbol('OPS_VALUES');

/**
 * The ops surface every service serves. On the gateway it rides the public port; backend
 * services serve it from their own `OPS_PORT` listener. It never opens a listener itself.
 */
@Module({})
export class OpsModule {
  static forRoot(options: OpsModuleOptions): DynamicModule {
    return {
      module: OpsModule,
      imports: options.imports ?? [],
      controllers: options.grpcHealth ? [OpsController, GrpcHealthController] : [OpsController],
      providers: [
        ReadinessService,
        ShutdownRegistry,
        { provide: VERSION_INFO, useValue: options.version },
        { provide: READINESS_CHECKS, ...options.checks },
      ],
      exports: [ReadinessService, ShutdownRegistry],
    };
  }

  /** The same surface, its version and checks built by one factory from injected services. */
  static forRootAsync(options: OpsModuleAsyncOptions): DynamicModule {
    return {
      module: OpsModule,
      imports: options.imports ?? [],
      controllers: options.grpcHealth ? [OpsController, GrpcHealthController] : [OpsController],
      providers: [
        ReadinessService,
        ShutdownRegistry,
        { provide: OPS_VALUES, inject: options.inject ?? [], useFactory: options.useFactory },
        {
          provide: VERSION_INFO,
          inject: [OPS_VALUES],
          useFactory: (values: OpsModuleValues) => values.version,
        },
        {
          provide: READINESS_CHECKS,
          inject: [OPS_VALUES],
          useFactory: (values: OpsModuleValues) => values.checks,
        },
      ],
      exports: [ReadinessService, ShutdownRegistry],
    };
  }
}
