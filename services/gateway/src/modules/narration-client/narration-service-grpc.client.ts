import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { narrationGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller } from '@wayfare/nest-common';

/** Injection token for narration's gRPC connection. */
export const NARRATION_GRPC = Symbol('NARRATION_GRPC');

/**
 * narration as the gateway calls it: one caller per stub (conventions §6.2). Returns proto types
 * only; the deadline, caller metadata and down-versus-slow mapping live in each caller.
 */
@Injectable()
export class NarrationServiceGrpcClient implements OnModuleInit {
  readonly narration: GrpcServiceCaller<narrationGrpc.NarrationServiceClient>;
  readonly synthesisAdmin: GrpcServiceCaller<narrationGrpc.SynthesisAdminServiceClient>;
  readonly pronunciations: GrpcServiceCaller<narrationGrpc.PronunciationServiceClient>;
  readonly corrections: GrpcServiceCaller<narrationGrpc.CorrectionServiceClient>;
  readonly hotset: GrpcServiceCaller<narrationGrpc.HotsetServiceClient>;
  readonly ttsStream: GrpcServiceCaller<narrationGrpc.TtsStreamServiceClient>;
  readonly uiBundles: GrpcServiceCaller<narrationGrpc.UiBundleServiceClient>;

  constructor(@Inject(NARRATION_GRPC) grpc: ClientGrpc) {
    this.narration = new GrpcServiceCaller(grpc, narrationGrpc.NARRATION_SERVICE_NAME);
    this.synthesisAdmin = new GrpcServiceCaller(grpc, narrationGrpc.SYNTHESIS_ADMIN_SERVICE_NAME);
    this.pronunciations = new GrpcServiceCaller(grpc, narrationGrpc.PRONUNCIATION_SERVICE_NAME);
    this.corrections = new GrpcServiceCaller(grpc, narrationGrpc.CORRECTION_SERVICE_NAME);
    this.hotset = new GrpcServiceCaller(grpc, narrationGrpc.HOTSET_SERVICE_NAME);
    this.ttsStream = new GrpcServiceCaller(grpc, narrationGrpc.TTS_STREAM_SERVICE_NAME);
    this.uiBundles = new GrpcServiceCaller(grpc, narrationGrpc.UI_BUNDLE_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.narration.init();
    this.synthesisAdmin.init();
    this.pronunciations.init();
    this.corrections.init();
    this.hotset.init();
    this.ttsStream.init();
    this.uiBundles.init();
  }
}
