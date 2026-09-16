import { connectivityState, status } from '@grpc/grpc-js';
import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import type { RequestContext } from '../context/request-context';
import { isGrpcServiceError } from '../errors/grpc-service-error';
import { packCallerContext } from './caller-context';

/** Default deadline for a service call (conventions §6.2). Override per call; never remove. */
export const DEFAULT_GRPC_DEADLINE_MS = 2_000;

/** A generated client method as Nest exposes it: request, metadata and grpc-js call options. */
type UnaryMethod = (request: never, metadata?: Metadata) => Observable<unknown>;

/** Names of the service's unary methods. */
type MethodName<Service> = {
  [K in keyof Service]: Service[K] extends UnaryMethod ? K : never;
}[keyof Service];

type RequestOf<M> = M extends (request: infer R, ...rest: never[]) => unknown ? R : never;
type ResponseOf<M> = M extends (...args: never[]) => Observable<infer R> ? R : never;

/** Per-call options. */
export interface GrpcCallOptions {
  readonly deadlineMs?: number;
}

/** A grpc-js channel state (grpc-js exports the enum as `connectivityState`). */
type ChannelState = (typeof connectivityState)[keyof typeof connectivityState];

/** The part of a grpc-js client `call()` needs to tell "down" from "slow". */
interface ChannelOwner {
  getChannel(): { getConnectivityState(tryToConnect: boolean): ChannelState };
}

/**
 * Base for every peer client (`<peer>-service-grpc.client.ts`). `call()` applies the deadline and
 * attaches the caller as metadata; trace context is propagated by the gRPC instrumentation.
 * A failed call rejects with the grpc-js `ServiceError` for the gateway's error filter to map.
 *
 * Down versus slow: grpc-js fails fast with `UNAVAILABLE` when a connection is refused, but an
 * address that silently drops packets (a stopped container) only surfaces as the deadline
 * passing while the channel is still connecting. A deadline that expires on a channel that never
 * became `READY` is therefore reported as `UNAVAILABLE` (503), not `DEADLINE_EXCEEDED` (504) —
 * a slow peer that did answer the connection keeps its 504.
 */
export abstract class BaseGrpcClient<Service extends object> implements OnModuleInit {
  private service: Service | undefined;

  protected constructor(
    private readonly grpc: ClientGrpc,
    private readonly serviceName: string,
  ) {}

  onModuleInit(): void {
    this.service = this.grpc.getService<Service>(this.serviceName);
  }

  /** Calls one unary method of the peer, by name. */
  protected async call<Name extends MethodName<Service>>(
    name: Name,
    request: RequestOf<Service[Name]>,
    context: RequestContext,
    options: GrpcCallOptions = {},
  ): Promise<ResponseOf<Service[Name]>> {
    const service = this.service;
    if (service === undefined) {
      throw new Error(`${this.serviceName} client used before module init`);
    }
    // Nest forwards (request, metadata, callOptions) straight to grpc-js.
    const method = service[name] as unknown as (
      this: Service,
      request: RequestOf<Service[Name]>,
      metadata: Metadata,
      callOptions: CallOptions,
    ) => Observable<ResponseOf<Service[Name]>>;
    const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_GRPC_DEADLINE_MS);
    try {
      return await firstValueFrom(
        method.call(service, request, packCallerContext(context), { deadline }),
      );
    } catch (error) {
      if (
        isGrpcServiceError(error) &&
        error.code === status.DEADLINE_EXCEEDED &&
        this.channelState() !== connectivityState.READY
      ) {
        throw Object.assign(error, {
          code: status.UNAVAILABLE,
          details: `${error.details} (peer unreachable)`,
        });
      }
      throw error;
    }
  }

  private channelState(): ChannelState | null {
    try {
      const client = this.grpc.getClientByServiceName<ChannelOwner>(this.serviceName);
      return client.getChannel().getConnectivityState(false);
    } catch {
      // No client to ask: leave the error as the peer reported it.
      return null;
    }
  }
}
