import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { narrationGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { PronunciationsService } from './pronunciations.service';

/** `wayfare.narration.PronunciationService` — unpack the caller, delegate once. */
@Controller()
@narrationGrpc.PronunciationServiceControllerMethods()
export class PronunciationsGrpcController implements narrationGrpc.PronunciationServiceController {
  constructor(private readonly pronunciations: PronunciationsService) {}

  listEntries(
    request: narrationGrpc.ListEntriesRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.ListEntriesResponse> {
    return this.pronunciations.listEntries(request, unpackCallerContext(metadata));
  }

  createEntry(
    request: narrationGrpc.CreateEntryRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.CreateEntryResponse> {
    return this.pronunciations.createEntry(request, unpackCallerContext(metadata));
  }

  updateEntry(
    request: narrationGrpc.UpdateEntryRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.UpdateEntryResponse> {
    return this.pronunciations.updateEntry(request, unpackCallerContext(metadata));
  }

  deleteEntry(
    request: narrationGrpc.DeleteEntryRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.DeleteEntryResponse> {
    return this.pronunciations.deleteEntry(request, unpackCallerContext(metadata));
  }

  previewAudio(
    request: narrationGrpc.PreviewAudioRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.PreviewAudioResponse> {
    return this.pronunciations.previewAudio(request, unpackCallerContext(metadata));
  }
}
