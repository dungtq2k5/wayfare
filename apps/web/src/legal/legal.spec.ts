import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LEGAL_DOCUMENT_VERSIONS } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { LEGAL_LANGUAGES, LEGAL_PAGES, legalText, parseLegal } from './legal';

const ROOT = resolve(__dirname, '..', '..', 'content', 'legal');

describe('the legal text (K12)', () => {
  it.each(Object.entries(LEGAL_PAGES))(
    '%s: the current version is committed in English and Vietnamese',
    (page, document) => {
      for (const lang of LEGAL_LANGUAGES) {
        const file = join(ROOT, page, `${LEGAL_DOCUMENT_VERSIONS[document]}.${lang}.md`);
        expect(existsSync(file), file).toBe(true);
      }
    },
  );

  it('reads the page language, and English with the line for any other', () => {
    expect(legalText('privacy', 'vi', null, ROOT)).toMatchObject({ lang: 'vi', translated: true });
    expect(legalText('privacy', 'ja', null, ROOT)).toMatchObject({ lang: 'en', translated: false });
  });

  it('opens a committed version by ?v=, and the current one for any other', () => {
    expect(legalText('terms', 'en', '2026-09-01', ROOT)?.version).toBe('2026-09-01');
    expect(legalText('terms', 'en', '1999-01-01', ROOT)?.version).toBe(
      LEGAL_DOCUMENT_VERSIONS.TERMS_OF_SERVICE,
    );
  });

  it('parses headings, paragraphs and the note, skipping the title', () => {
    expect(parseLegal('# Title\n\n## One\n\nText\nmore.\n\n> Draft')).toEqual([
      { kind: 'heading', text: 'One' },
      { kind: 'paragraph', text: 'Text more.' },
      { kind: 'note', text: 'Draft' },
    ]);
  });
});
