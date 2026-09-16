import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { healthGrpc } from '@wayfare/contracts/grpc';
import { ReadinessService } from '../health/readiness';

/** `grpc.health.v1.Health/Check` — `SERVING` while the service's readiness checks pass. */
@Controller()
export class GrpcHealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @GrpcMethod('Health', 'Check')
  async check(): Promise<healthGrpc.HealthCheckResponse> {
    const report = await this.readiness.check();
    return {
      status: report.ready
        ? healthGrpc.HealthCheckResponse_ServingStatus.SERVING
        : healthGrpc.HealthCheckResponse_ServingStatus.NOT_SERVING,
    };
  }
}
