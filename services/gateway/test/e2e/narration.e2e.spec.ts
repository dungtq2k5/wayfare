import { status } from '@grpc/grpc-js';
import { newId, OnDemandStatus } from '@wayfare/contracts';
import { narrationGrpc, onDemandStatusProto } from '@wayfare/contracts/grpc';
import {
  NARRATION_FIXTURE_IDS,
  synthesisJobFixture,
  synthesisTaskFixture,
} from '@wayfare/contracts/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, deviceToken, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const placeId = newId();
const jobId = NARRATION_FIXTURE_IDS.job;

/** A phone's request, carrying a device token. */
function phone(method: 'get' | 'post', path: string) {
  const agent = request(server());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'mobile')
    .set('X-Wayfare-App-Version', '1.0.0')
    .set('Authorization', `Bearer ${deviceToken()}`);
}

/** A console request with the given permissions. */
function console_(
  method: 'get' | 'post',
  path: string,
  perms = ['narration.job.read', 'narration.job.manage'],
) {
  const agent = request(server());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', `wf_at=${accountToken({ perms })}`);
}

const onDemand = (answer: Partial<narrationGrpc.RequestOnDemandResponse>) => () =>
  Promise.resolve({ audio: undefined, retryAfterMs: 0, ...answer });

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
  gateway.narration.reset();
});

describe('POST /narration/on-demand', () => {
  it('answers 202 with the job while it is made', async () => {
    gateway.narration.narration.handlers.requestOnDemand = onDemand({
      status: onDemandStatusProto.toProto(OnDemandStatus.PENDING),
      jobId,
      retryAfterMs: 5_000,
    });
    const res = await phone('post', '/narration/on-demand').send({ placeId, lang: 'en-US' });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ status: 'PENDING', jobId, retryAfterMs: 5_000 });
    expect(gateway.narration.narration.calls[0]!.request).toEqual({ placeId, lang: 'en-US' });
  });

  it('answers 200 with ready audio, and 200 for a language narration does not serve', async () => {
    gateway.narration.narration.handlers.requestOnDemand = onDemand({
      status: onDemandStatusProto.toProto(OnDemandStatus.READY),
      audio: {
        url: 'https://media.wayfare.test/audio/a.mp3',
        sha256: 'c'.repeat(64),
        bytes: 10,
        durationMs: 1000,
      },
    });
    const ready = await phone('post', '/narration/on-demand').send({ placeId, lang: 'en' });
    expect(ready.status).toBe(200);
    expect(ready.body.data.status).toBe('READY');

    gateway.narration.narration.handlers.requestOnDemand = onDemand({
      status: onDemandStatusProto.toProto(OnDemandStatus.UNAVAILABLE),
    });
    const unavailable = await phone('post', '/narration/on-demand').send({ placeId, lang: 'xx' });
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.data).toEqual({ status: 'UNAVAILABLE' });
  });

  it('maps narration refusals', async () => {
    gateway.narration.narration.handlers.requestOnDemand = () =>
      Promise.reject(
        serviceError(status.UNAVAILABLE, { 'wf-error-code': 'ENTITLEMENTS_UNAVAILABLE' }),
      );
    const res = await phone('post', '/narration/on-demand').send({ placeId, lang: 'en' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ENTITLEMENTS_UNAVAILABLE');
  });

  it('refuses a console session without a device', async () => {
    const res = await console_('post', '/narration/on-demand').send({ placeId, lang: 'en' });
    expect(res.status).toBe(401);
  });
});

describe('GET /narration/places/:placeId/status', () => {
  it('is privately cached for two seconds', async () => {
    gateway.narration.narration.handlers.getNarrationStatus = () =>
      Promise.resolve({ textReady: true, audioStatus: 2, audio: undefined, stale: false });
    const res = await phone('get', `/narration/places/${placeId}/status?lang=ja`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=2');
    expect(res.body.data).toMatchObject({ textReady: true, audio: null, stale: false });
  });
});

describe('/admin/narration', () => {
  it('lists jobs a page at a time', async () => {
    gateway.narration.synthesisAdmin.handlers.listJobs = () =>
      Promise.resolve({ jobs: [synthesisJobFixture()], page: { page: 1, pageSize: 20, total: 1 } });
    const res = await console_('get', '/admin/narration/jobs?status=RUNNING');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: jobId, status: 'RUNNING', trigger: 'APPROVAL' });
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    expect(gateway.narration.synthesisAdmin.calls[0]!.request).toMatchObject({
      status: narrationGrpc.SynthesisJobStatus.SYNTHESIS_JOB_STATUS_RUNNING,
    });
  });

  it('details a job with its tasks', async () => {
    gateway.narration.synthesisAdmin.handlers.getJob = () =>
      Promise.resolve({ job: synthesisJobFixture(), tasks: [synthesisTaskFixture()] });
    const res = await console_('get', `/admin/narration/jobs/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tasks[0]).toMatchObject({
      lang: 'en',
      stage: 'SYNTHESIZE',
      status: 'RUNNING',
    });
  });

  it('creates a manual job (201) and pauses one (200), each answering { job }', async () => {
    gateway.narration.synthesisAdmin.handlers.createManualJob = () =>
      Promise.resolve({ job: synthesisJobFixture() });
    gateway.narration.synthesisAdmin.handlers.pauseJob = () =>
      Promise.resolve({
        job: synthesisJobFixture({
          status: narrationGrpc.SynthesisJobStatus.SYNTHESIS_JOB_STATUS_PAUSED,
        }),
      });
    const created = await console_('post', '/admin/narration/jobs').send({
      targetType: 'PLACE',
      targetId: placeId,
      langs: ['en'],
      includeAudio: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.job.id).toBe(jobId);
    const paused = await console_('post', `/admin/narration/jobs/${jobId}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body.data.job.status).toBe('PAUSED');
  });

  it('refuses audio for a menu item before calling narration', async () => {
    const res = await console_('post', '/admin/narration/jobs').send({
      targetType: 'MENU_ITEM',
      targetId: placeId,
      langs: ['en'],
      includeAudio: true,
    });
    expect(res.status).toBe(400);
    expect(gateway.narration.synthesisAdmin.calls).toHaveLength(0);
  });

  it('needs narration.job.manage to act, and narration.job.read to look', async () => {
    const act = await console_('post', `/admin/narration/jobs/${jobId}/cancel`, [
      'narration.job.read',
    ]);
    expect(act.status).toBe(403);
    const look = await console_('get', '/admin/narration/providers', []);
    expect(look.status).toBe(403);
  });

  it('maps a job that is no longer active to 409', async () => {
    gateway.narration.synthesisAdmin.handlers.resumeJob = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, { 'wf-error-code': 'SYNTHESIS_JOB_NOT_ACTIVE' }),
      );
    const res = await console_('post', `/admin/narration/jobs/${jobId}/resume`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SYNTHESIS_JOB_NOT_ACTIVE');
  });

  it('reports providers and voices', async () => {
    gateway.narration.synthesisAdmin.handlers.listProviders = () =>
      Promise.resolve({
        providers: [
          {
            name: 'fake',
            role: 'speech',
            position: 0,
            breaker: 'closed',
            consecutiveFailures: 0,
            errorRate: 0,
            recentCalls: 3,
            coolingUntil: undefined,
          },
        ],
      });
    gateway.narration.synthesisAdmin.handlers.listVoices = () =>
      Promise.resolve({
        voices: [
          {
            lang: 'en',
            provider: 'fake',
            pinnedVoiceId: 'fake-en',
            available: [{ id: 'fake-en', languageCode: 'en' }],
          },
        ],
      });
    const providers = await console_('get', '/admin/narration/providers');
    expect(providers.body.data).toEqual([
      expect.objectContaining({
        name: 'fake',
        breaker: 'closed',
        coolingUntil: null,
        scope: 'process',
      }),
    ]);
    const voices = await console_('get', '/admin/narration/voices');
    expect(voices.body.data[0]).toMatchObject({ lang: 'en', pinnedVoiceId: 'fake-en' });
  });
});
