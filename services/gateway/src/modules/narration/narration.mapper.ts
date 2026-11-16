import { OnDemandStatus } from '@wayfare/contracts';
import type { PlaceAudio } from '@wayfare/contracts';
import { audioStatusProto, onDemandStatusProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import type { NarrationStatusResponseDto, OnDemandAnswer } from './dto/narration-response.dto';

/** A served narration file. */
export function toPlaceAudio(audio: narrationGrpc.NarrationAudio): PlaceAudio {
  return { url: audio.url, sha256: audio.sha256, bytes: audio.bytes, durationMs: audio.durationMs };
}

/** The on-demand answer, by its status. */
export function toOnDemandAnswer(response: narrationGrpc.RequestOnDemandResponse): OnDemandAnswer {
  const status = onDemandStatusProto.fromProto(response.status);
  switch (status) {
    case OnDemandStatus.READY:
      if (response.audio === undefined || response.audio === null) {
        throw new Error('narration answered READY without audio');
      }
      return { status, audio: toPlaceAudio(response.audio) };
    case OnDemandStatus.PENDING:
      if (response.jobId === undefined) throw new Error('narration answered PENDING without a job');
      return { status, jobId: response.jobId, retryAfterMs: response.retryAfterMs };
    case OnDemandStatus.UNAVAILABLE:
      return { status };
    default:
      throw new Error(`narration sent an unknown on-demand status: ${String(response.status)}`);
  }
}

/** A Place's narration status in one language. */
export function toNarrationStatusResponseDto(
  response: narrationGrpc.GetNarrationStatusResponse,
): NarrationStatusResponseDto {
  const audioStatus =
    response.audioStatus === undefined ? null : audioStatusProto.fromProto(response.audioStatus);
  if (response.audioStatus !== undefined && audioStatus === null) {
    throw new Error(`narration sent an unknown audio status: ${String(response.audioStatus)}`);
  }
  return {
    textReady: response.textReady,
    audioStatus: audioStatus,
    audio:
      response.audio === undefined || response.audio === null ? null : toPlaceAudio(response.audio),
    stale: response.stale,
  };
}
