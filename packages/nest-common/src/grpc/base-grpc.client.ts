import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import type { RequestContext } from '../context/request-context';
import { GrpcServiceCaller } from './grpc-service-caller';
import type { GrpcCallOptions, MethodName, RequestOf, ResponseOf } from './grpc-service-caller';

export { DEFAULT_GRPC_DEADLINE_MS } from './grpc-service-caller';
export type { GrpcCallOptions } from './grpc-service-caller';

/**
 * Base for a peer client with a single stub (conventions §6.2) — a thin wrapper over one
 * `GrpcServiceCaller`. A peer serving several services holds one caller per stub instead.
 */
export abstract class BaseGrpcClient<Service extends object> implements OnModuleInit {
  private readonly caller: GrpcServiceCaller<Service>;

  protected constructor(grpc: ClientGrpc, serviceName: string) {
    this.caller = new GrpcServiceCaller<Service>(grpc, serviceName);
  }

  onModuleInit(): void {
    this.caller.init();
  }

  /** Calls one unary method of the peer, by name. */
  protected call<Name extends MethodName<Service>>(
    name: Name,
    request: RequestOf<Service[Name]>,
    context: RequestContext,
    options: GrpcCallOptions = {},
  ): Promise<ResponseOf<Service[Name]>> {
    return this.caller.call(name, request, context, options);
  }
}
