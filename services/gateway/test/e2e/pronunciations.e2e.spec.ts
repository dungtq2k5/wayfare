// The console's two narration-text screens (api-endpoints-plan §4.4–4.5): the pronunciation
// dictionary, whose preview comes back as audio rather than JSON, and the correction screen.
import { status } from '@grpc/grpc-js';
import {
  LocalizationTargetType,
  newId,
  OverrideStatus,
  ReplacementType,
  TranslationSource,
} from '@wayfare/contracts';
import type { LocalizationOverview } from '@wayfare/contracts';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import {
  audioStatusProto,
  localizationTargetTypeProto,
  overrideStatusProto,
  replacementTypeProto,
} from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const entryId = newId();
const placeId = newId();
const at = toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z'));
const PLACE = localizationTargetTypeProto.toProto(LocalizationTargetType.PLACE);

/** A console request with the given permissions. */
function console_(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  perms = ['pronunciation.manage', 'localization.edit'],
) {
  const agent = request(server());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', `wf_at=${accountToken({ perms })}`);
}

const entry = (
  over: Partial<narrationGrpc.PronunciationEntry> = {},
): narrationGrpc.PronunciationEntry => ({
  id: entryId,
  term: 'Bến Thành',
  targetLang: 'en',
  replacementType: replacementTypeProto.toProto(ReplacementType.SUB),
  replacement: 'ben tahn',
  note: 'sample',
  isActive: true,
  updatedAt: at,
  ...over,
});

const correction = (over: Partial<narrationGrpc.Correction> = {}): narrationGrpc.Correction => ({
  id: newId(),
  targetType: PLACE,
  targetId: placeId,
  lang: 'en',
  sourceContentHash: 'a'.repeat(64),
  name: 'Ben Thanh Market',
  description: 'A market since 1914.',
  status: overrideStatusProto.toProto(OverrideStatus.ACTIVE),
  supersededByHash: false,
  editedById: newId(),
  updatedAt: at,
  ...over,
});

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
  gateway.narration.reset();
});

describe('/admin/narration/pronunciations', () => {
  it('lists, creates, edits and deletes an entry', async () => {
    gateway.narration.pronunciations.handlers.listEntries = () =>
      Promise.resolve({ entries: [entry()], page: { nextCursor: 'next' } });
    const list = await console_('get', '/admin/narration/pronunciations?q=Bến&limit=20');
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toEqual({
      id: entryId,
      term: 'Bến Thành',
      targetLang: 'en',
      replacementType: 'SUB',
      replacement: 'ben tahn',
      alphabet: null,
      note: 'sample',
      isActive: true,
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(list.body.meta).toMatchObject({ nextCursor: 'next' });
    expect(gateway.narration.pronunciations.calls[0]!.request).toMatchObject({ q: 'Bến' });

    gateway.narration.pronunciations.handlers.createEntry = () =>
      Promise.resolve({ entry: entry() });
    const created = await console_('post', '/admin/narration/pronunciations').send({
      term: 'Bến Thành',
      targetLang: 'en',
      replacementType: 'SUB',
      replacement: 'ben tahn',
      note: 'sample',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.entry.term).toBe('Bến Thành');

    gateway.narration.pronunciations.handlers.updateEntry = () =>
      Promise.resolve({ entry: entry({ isActive: false }) });
    const patched = await console_('patch', `/admin/narration/pronunciations/${entryId}`).send({
      isActive: false,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.entry.isActive).toBe(false);
    expect(gateway.narration.pronunciations.calls.at(-1)!.request).toEqual({
      entryId,
      isActive: false,
    });

    gateway.narration.pronunciations.handlers.deleteEntry = () => Promise.resolve({});
    expect((await console_('delete', `/admin/narration/pronunciations/${entryId}`)).status).toBe(
      204,
    );
  });

  it('maps a term already taken to 409', async () => {
    gateway.narration.pronunciations.handlers.createEntry = () =>
      Promise.reject(
        serviceError(status.ALREADY_EXISTS, {
          'wf-error-code': 'PRONUNCIATION_TERM_EXISTS',
          'wf-http-status': '409',
        }),
      );
    const res = await console_('post', '/admin/narration/pronunciations').send({
      term: 'Bến Thành',
      replacementType: 'SUB',
      replacement: 'ben tahn',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRONUNCIATION_TERM_EXISTS');
  });

  it('answers the preview with the audio itself, not an envelope', async () => {
    const audio = Buffer.from('ID3fake-mp3-bytes');
    gateway.narration.pronunciations.handlers.previewAudio = () =>
      Promise.resolve({ audio, contentType: 'audio/mpeg' });
    const res = await console_('post', '/admin/narration/pronunciations/preview')
      .send({
        text: 'Chợ Bến Thành mở cửa.',
        lang: 'en',
        entries: [
          { term: 'Bến Thành', replacementType: 'SUB', replacement: 'ben tahn', targetLang: 'en' },
        ],
      })
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(Buffer.from(res.body as Buffer).equals(audio)).toBe(true);
    expect(gateway.narration.pronunciations.calls[0]!.request).toMatchObject({
      text: 'Chợ Bến Thành mở cửa.',
      lang: 'en',
    });
  });

  it('refuses a console session without the permission', async () => {
    const res = await console_('get', '/admin/narration/pronunciations', ['narration.job.read']);
    expect(res.status).toBe(403);
  });
});

describe('/admin/narration/localizations', () => {
  const overview: LocalizationOverview = {
    targetType: LocalizationTargetType.PLACE,
    targetId: placeId,
    sourceContentHash: 'a'.repeat(64),
    nameVi: 'Chợ Bến Thành',
    descriptionVi: null,
    languages: [
      {
        lang: 'en',
        name: 'Ben Thanh Market',
        description: null,
        translationSource: TranslationSource.HUMAN,
        audioStatus: audioStatusProto.fromProto(2)!,
        correction: null,
      },
    ],
  };

  it('shows every language beside the correction held for it', async () => {
    gateway.narration.corrections.handlers.getLocalizationOverview = () =>
      Promise.resolve({ overviewJson: JSON.stringify(overview) });
    const res = await console_('get', `/admin/narration/localizations/PLACE/${placeId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      sourceContentHash: 'a'.repeat(64),
      languages: [{ lang: 'en', name: 'Ben Thanh Market', correction: null }],
    });
    expect(gateway.narration.corrections.calls[0]!.request).toEqual({
      targetType: PLACE,
      targetId: placeId,
    });
  });

  it('corrects one language against the hash shown, and refuses a stale one', async () => {
    gateway.narration.corrections.handlers.putCorrection = () =>
      Promise.resolve({ correction: correction() });
    const put = await console_('put', `/admin/narration/localizations/PLACE/${placeId}/en`).send({
      sourceContentHash: 'a'.repeat(64),
      name: 'Ben Thanh Market',
      description: 'A market since 1914.',
    });
    expect(put.status).toBe(200);
    expect(put.body.data.correction).toMatchObject({
      lang: 'en',
      status: 'ACTIVE',
      supersededByHash: false,
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    gateway.narration.corrections.handlers.putCorrection = () =>
      Promise.reject(
        serviceError(status.ABORTED, {
          'wf-error-code': 'LOCALIZATION_SOURCE_CHANGED',
          'wf-http-status': '409',
        }),
      );
    const stale = await console_('put', `/admin/narration/localizations/PLACE/${placeId}/en`).send({
      sourceContentHash: 'b'.repeat(64),
      name: 'Ben Thanh Market',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('LOCALIZATION_SOURCE_CHANGED');
  });

  it('reverts a correction, and refuses the source language', async () => {
    gateway.narration.corrections.handlers.revertCorrection = () => Promise.resolve({});
    expect(
      (await console_('delete', `/admin/narration/localizations/PLACE/${placeId}/en`)).status,
    ).toBe(204);
    expect(gateway.narration.corrections.calls[0]!.request).toEqual({
      targetType: PLACE,
      targetId: placeId,
      lang: 'en',
    });

    gateway.narration.corrections.handlers.revertCorrection = () =>
      Promise.reject(
        serviceError(status.INVALID_ARGUMENT, {
          'wf-error-code': 'VALIDATION_FAILED',
          'wf-http-status': '400',
        }),
      );
    expect(
      (await console_('delete', `/admin/narration/localizations/PLACE/${placeId}/vi`)).status,
    ).toBe(400);
  });
});
