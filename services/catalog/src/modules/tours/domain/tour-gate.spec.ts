import { describe, expect, it } from 'vitest';
import { tourGate } from './tour-gate';

const HASH = 'a'.repeat(64);
const OLD = 'b'.repeat(64);

describe("a tour's gate", () => {
  it('opens on the English text for the current hash, once requested', () => {
    expect(
      tourGate({ contentHash: HASH, activationRequestedAt: new Date(), enSourceContentHash: HASH }),
    ).toEqual({ open: true, missing: [] });
  });

  it('waits for the English text — a stale one is not enough — and for the request', () => {
    expect(
      tourGate({ contentHash: HASH, activationRequestedAt: null, enSourceContentHash: OLD }),
    ).toEqual({ open: false, missing: ['en.text', 'activation'] });
    expect(
      tourGate({ contentHash: HASH, activationRequestedAt: new Date(), enSourceContentHash: null })
        .missing,
    ).toEqual(['en.text']);
  });
});
