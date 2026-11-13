import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { narrationGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { TtsStreamService } from './tts-stream.service';

/** `wayfare.narration.TtsStreamService` — unpack the caller, delegate once. */
@Controller()
@narrationGrpc.TtsStreamServiceControllerMethods()
export class TtsStreamGrpcController implements narrationGrpc.TtsStreamServiceController {
  constructor(private readonly stream: TtsStreamService) {}

  getStreamAudio(
    request: narrationGrpc.GetStreamAudioRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.GetStreamAudioResponse> {
    return this.stream.getStreamAudio(request, unpackCallerContext(metadata));
  }
}
