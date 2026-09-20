// narration's tourist surface (api-endpoints-plan §4.1–4.2): the language switch, the
// walk-ahead prefetch, the live stream that answers audio rather than JSON, and the UI bundles.
import { status } from '@grpc/grpc-js';
import { newId, UiBundleStatus } from '@wayfare/contracts';
import { uiBundleStatusProto } from '@wayfare/contracts/grpc';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootGateway, deviceToken, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const placeId = newId();
const APP_VERSION = '1.0.0';

/** A phone's request, carrying a device token. */
function phone(method: 'get' | 'post', path: string) {
  const agent = request(server());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'mobile')
    .set('X-Wayfare-App-Version', APP_VERSION)
    .set('Authorization', `Bearer ${deviceToken()}`);
}

/** Anyone at all: the bundles are public. */
const anyone = (path: string) =>
  request(server()).get(`/api/v1${path}`).set('X-Wayfare-Client', 'mobile');

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
  gateway.narration.reset();
});

describe('POST /narration/hotset', () => {
  it('passes the point and language through and answers the counts', async () => {
    gateway.narration.hotset.handlers.hotset = () =>
      Promise.resolve({ ready: [placeId], pending: [], requiredReadyCount: 3 });
    const res = await phone('post', '/narration/hotset').send({
      lat: 10.7725,
      lng: 106.698,
      lang: 'ja',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ready: [placeId], pending: [], requiredReadyCount: 3 });
    expect(gateway.narration.hotset.calls[0]!.request).toEqual({
      lat: 10.7725,
      lng: 106.698,
      lang: 'ja',
    });
  });

  it('refuses a point off the globe', async () => {
    const res = await phone('post', '/narration/hotset').send({ lat: 91, lng: 0, lang: 'ja' });
    expect(res.status).toBe(400);
  });
});

describe('POST /narration/prefetch', () => {
  it('answers 202 with what it queued and what it passed over', async () => {
    const skipped = newId();
    gateway.narration.hotset.handlers.prefetch = () =>
      Promise.resolve({ queued: [placeId], skipped: [skipped] });
    const res = await phone('post', '/narration/prefetch').send({
      placeIds: [placeId, skipped],
      lang: 'ja',
    });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ queued: [placeId], skipped: [skipped] });
  });

  it('refuses more ids than a prefetch may name', async () => {
    const res = await phone('post', '/narration/prefetch').send({
      placeIds: [newId(), newId(), newId(), newId()],
      lang: 'ja',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /narration/tts/stream', () => {
  it('answers the audio itself, unwrapped and uncached', async () => {
    const audio = Buffer.from('ID3fake-mp3-bytes');
    gateway.narration.ttsStream.handlers.getStreamAudio = () =>
      Promise.resolve({ audio, contentType: 'audio/mpeg' });
    const res = await phone('get', `/narration/tts/stream?placeId=${placeId}&lang=ja`)
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(res.body as Buffer).equals(audio)).toBe(true);
  });

  it('answers a refusal as an ordinary JSON envelope', async () => {
    gateway.narration.ttsStream.handlers.getStreamAudio = () =>
      Promise.reject(
        serviceError(status.ABORTED, {
          'wf-error-code': 'INVALID_STATE',
          'wf-http-status': '409',
          'wf-error-details': JSON.stringify({ status: 'NO_VOICE' }),
        }),
      );
    const res = await phone('get', `/narration/tts/stream?placeId=${placeId}&lang=xx`);
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE',
      details: { status: 'NO_VOICE' },
    });
  });
});

describe('GET /i18n/bundles/:namespace/:locale', () => {
  const hash = 'a'.repeat(64);
  const ready = () => ({
    namespace: 'tourist',
    locale: 'vi',
    status: uiBundleStatusProto.toProto(UiBundleStatus.READY),
    sourceHash: hash,
    messages: { 'nav.explore': 'Khám phá' },
    failedKeys: [],
    retryAfterMs: undefined,
  });

  it('is public, long-cached, tagged by its source version, and revalidates to 304', async () => {
    gateway.narration.uiBundles.handlers.getBundle = () => Promise.resolve(ready());
    const res = await anyone('/i18n/bundles/tourist/vi');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'READY', sourceHash: hash });
    expect(res.headers['cache-control']).toBe('public, max-age=3600, stale-while-revalidate=86400');
    expect(res.headers.etag).toBe(`"${hash}"`);

    const again = await anyone('/i18n/bundles/tourist/vi').set('If-None-Match', `"${hash}"`);
    expect(again.status).toBe(304);

    // `?sourceHash=` is a hint: an older one still gets the current bundle, not a 304.
    const stale = await anyone(`/i18n/bundles/tourist/vi?sourceHash=${'b'.repeat(64)}`);
    expect(stale.status).toBe(200);
    expect(stale.body.data.sourceHash).toBe(hash);
  });

  it('answers a pending bundle in English, uncached, with Retry-After', async () => {
    gateway.narration.uiBundles.handlers.getBundle = () =>
      Promise.resolve({
        ...ready(),
        locale: 'th',
        status: uiBundleStatusProto.toProto(UiBundleStatus.PENDING),
        messages: { 'nav.explore': 'Explore' },
        retryAfterMs: 5_000,
      });
    const res = await anyone('/i18n/bundles/tourist/th');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'PENDING', locale: 'th', retryAfterMs: 5_000 });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['retry-after']).toBe('5');
  });

  it('refuses a namespace it does not serve', async () => {
    expect((await anyone('/i18n/bundles/admin/vi')).status).toBe(400);
  });
});
