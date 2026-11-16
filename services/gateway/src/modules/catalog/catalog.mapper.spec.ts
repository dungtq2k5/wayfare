import { contentTierProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { ContentTier } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { toPlaceLocalization } from './catalog.mapper';

const localization = (lang: string) =>
  ({
    lang,
    name: 'Café',
    description: '',
    contentTier: contentTierProto.toProto(ContentTier.REQUESTED),
    stale: false,
  }) as unknown as catalogGrpc.PlaceLocalization;

describe('toPlaceLocalization', () => {
  it('keeps a served language', () => {
    expect(toPlaceLocalization(localization('en')).lang).toBe('en');
  });

  it('throws on a row whose language is not one we serve, so the request fails loudly', () => {
    expect(() => toPlaceLocalization(localization('xx'))).toThrow(/"xx"/);
  });
});
