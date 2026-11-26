import { AudioStatus, OnDemandStatus } from '@wayfare/contracts';
import { audioStatusProto, onDemandStatusProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it } from 'vitest';
import { toNarrationStatusResponseDto, toOnDemandAnswer } from './narration.mapper';

const audio = { url: 'https://media.test/a.mp3', sha256: 'a', bytes: 1, durationMs: 900 };
const onDemand = (status: OnDemandStatus, over: Partial<narrationGrpc.RequestOnDemandResponse>) =>
  toOnDemandAnswer({
    status: onDemandStatusProto.toProto(status),
    ...over,
  } as narrationGrpc.RequestOnDemandResponse);

describe('the on-demand answer', () => {
  it('ready carries the audio; pending the job and when to ask again; unavailable nothing', () => {
    expect(onDemand(OnDemandStatus.READY, { audio })).toEqual({ status: 'READY', audio });
    expect(onDemand(OnDemandStatus.PENDING, { jobId: 'j1', retryAfterMs: 2000 })).toEqual({
      status: 'PENDING',
      jobId: 'j1',
      retryAfterMs: 2000,
    });
    expect(onDemand(OnDemandStatus.UNAVAILABLE, {})).toEqual({ status: 'UNAVAILABLE' });
  });

  it('refuses ready without audio, pending without a job, and a status it doesn’t know', () => {
    expect(() => onDemand(OnDemandStatus.READY, {})).toThrow('READY without audio');
    expect(() => onDemand(OnDemandStatus.PENDING, {})).toThrow('PENDING without a job');
    expect(() =>
      toOnDemandAnswer({ status: 99 } as unknown as narrationGrpc.RequestOnDemandResponse),
    ).toThrow('unknown on-demand status: 99');
  });
});

describe('a Place’s narration status', () => {
  it('reads absent audio and audio status as null', () => {
    expect(
      toNarrationStatusResponseDto({
        textReady: true,
        stale: false,
      } as narrationGrpc.GetNarrationStatusResponse),
    ).toEqual({ textReady: true, audioStatus: null, audio: null, stale: false });
  });

  it('reads the audio and its status when narration sends them', () => {
    expect(
      toNarrationStatusResponseDto({
        textReady: true,
        stale: false,
        audioStatus: audioStatusProto.toProto(AudioStatus.READY),
        audio,
      }),
    ).toMatchObject({ audioStatus: AudioStatus.READY, audio });
  });

  it('refuses an audio status this build doesn’t know', () => {
    expect(() =>
      toNarrationStatusResponseDto({
        textReady: true,
        stale: false,
        audioStatus: 99,
      } as unknown as narrationGrpc.GetNarrationStatusResponse),
    ).toThrow('unknown audio status: 99');
  });
});
