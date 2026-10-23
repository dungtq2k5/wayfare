// The writer for src/generated/{tourist,console}-arguments.ts: `pnpm i18n:types` runs it with
// I18N_TYPES_WRITE=1; every other run fails when a committed file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderArgumentTypes } from './arguments-types';
import { readUiBundle } from './locales';

const GENERATED = [
  { namespace: 'tourist', type: 'TouristArguments' },
  { namespace: 'console', type: 'ConsoleArguments' },
] as const;

describe('the generated argument types', () => {
  it.each(GENERATED)('$namespace-arguments.ts is the English source’s', ({ namespace, type }) => {
    const file = resolve(__dirname, 'generated', `${namespace}-arguments.ts`);
    const source = renderArgumentTypes(type, readUiBundle('en', namespace), 'pnpm i18n:types');
    if (process.env.I18N_TYPES_WRITE === '1') {
      writeFileSync(file, source);
      return;
    }
    expect(
      readFileSync(file, 'utf8'),
      `packages/i18n/src/generated/${namespace}-arguments.ts is stale: run \`pnpm i18n:types\` and commit the result`,
    ).toBe(source);
  });
});
