import { describe, expect, it } from 'vitest';
import {
  CATALOG_MENU_CONTENT_CHANGED,
  CATALOG_PLACE_CONTENT_CHANGED,
} from '../events/catalog.events';
import { menuContentChangedFixture, placeContentChangedFixture } from './narration-fixtures';

const ID = '01990000-0000-7000-8000-000000000040';

describe('narration event fixtures', () => {
  it('are valid payloads of their subjects', () => {
    expect(
      CATALOG_PLACE_CONTENT_CHANGED.schema.safeParse(
        placeContentChangedFixture({ placeId: ID, contentHash: 'a'.repeat(64) }),
      ).success,
    ).toBe(true);
    expect(
      CATALOG_MENU_CONTENT_CHANGED.schema.safeParse(
        menuContentChangedFixture({ placeId: ID, menuItemIds: [ID] }),
      ).success,
    ).toBe(true);
  });
});
