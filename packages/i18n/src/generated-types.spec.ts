// The writer for src/generated/tourist-arguments.ts: `pnpm i18n:types` runs it with
// I18N_TYPES_WRITE=1; every other run fails when the committed file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderArgumentTypes } from './arguments-types';
import { readUiBundle } from './locales';

const TOURIST_FILE = resolve(__dirname, 'generated', 'tourist-arguments.ts');

describe('the generated argument types', () => {
  it('tourist-arguments.ts is the English source’s', () => {
    const source = renderArgumentTypes(
      'TouristArguments',
      readUiBundle('en', 'tourist'),
      'pnpm i18n:types',
    );
    if (process.env.I18N_TYPES_WRITE === '1') {
      writeFileSync(TOURIST_FILE, source);
      return;
    }
    expect(
      readFileSync(TOURIST_FILE, 'utf8'),
      'packages/i18n/src/generated/tourist-arguments.ts is stale: run `pnpm i18n:types` and commit the result',
    ).toBe(source);
  });
});
