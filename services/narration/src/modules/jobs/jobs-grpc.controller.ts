import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { narrationGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { JobsService } from './jobs.service';

/** `wayfare.narration.SynthesisAdminService` — unpack the caller, delegate once. */
@Controller()
@narrationGrpc.SynthesisAdminServiceControllerMethods()
export class JobsGrpcController implements narrationGrpc.SynthesisAdminServiceController {
  constructor(private readonly jobs: JobsService) {}

  listJobs(
    request: narrationGrpc.ListJobsRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.ListJobsResponse> {
    return this.jobs.listJobs(request, unpackCallerContext(metadata));
  }

  getJob(
    request: narrationGrpc.GetJobRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.GetJobResponse> {
    return this.jobs.getJob(request, unpackCallerContext(metadata));
  }

  createManualJob(
    request: narrationGrpc.CreateManualJobRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.CreateManualJobResponse> {
    return this.jobs.createManualJob(request, unpackCallerContext(metadata));
  }

  pauseJob(
    request: narrationGrpc.PauseJobRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.PauseJobResponse> {
    return this.jobs.pauseJob(request, unpackCallerContext(metadata));
  }

  resumeJob(
    request: narrationGrpc.ResumeJobRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.ResumeJobResponse> {
    return this.jobs.resumeJob(request, unpackCallerContext(metadata));
  }

  cancelJob(
    request: narrationGrpc.CancelJobRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.CancelJobResponse> {
    return this.jobs.cancelJob(request, unpackCallerContext(metadata));
  }

  retryFailedTasks(
    request: narrationGrpc.RetryFailedTasksRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.RetryFailedTasksResponse> {
    return this.jobs.retryFailedTasks(request, unpackCallerContext(metadata));
  }

  listProviders(
    _request: narrationGrpc.ListProvidersRequest,
    metadata?: Metadata,
  ): narrationGrpc.ListProvidersResponse {
    return this.jobs.listProviders(unpackCallerContext(metadata));
  }

  listVoices(
    _request: narrationGrpc.ListVoicesRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.ListVoicesResponse> {
    return this.jobs.listVoices(unpackCallerContext(metadata));
  }
}
