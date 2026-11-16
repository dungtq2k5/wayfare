import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';

/** The three documents, by their pages' paths (K12). */
export const LEGAL_PAGES = {
  privacy: LegalDocument.PRIVACY_POLICY,
  terms: LegalDocument.TERMS_OF_SERVICE,
  'owner-agreement': LegalDocument.OWNER_AGREEMENT,
} as const;

export type LegalPage = keyof typeof LEGAL_PAGES;

/** The languages the legal text launches in (K12, the product owner). */
export const LEGAL_LANGUAGES = ['en', 'vi'] as const;

/** One block of a document: a heading, a paragraph, or the draft's note. */
export type LegalBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'note'; readonly text: string };

export interface LegalText {
  readonly version: string;
  /** The language the text is in: the page's, or English when not translated. */
  readonly lang: string;
  readonly translated: boolean;
  readonly blocks: readonly LegalBlock[];
  /** Every version committed, newest first, for `?v=`. */
  readonly versions: readonly string[];
}

/** The committed text's folder: `apps/web/content/legal`. */
export const LEGAL_ROOT = join(process.cwd(), 'content', 'legal');

/** The few Markdown forms the files use: `#` (the title, skipped), `##`, `>`, paragraphs. */
export function parseLegal(markdown: string): LegalBlock[] {
  return markdown
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '' && !/^# /.test(chunk))
    .map((chunk): LegalBlock =>
      chunk.startsWith('## ')
        ? { kind: 'heading', text: chunk.slice(3).trim() }
        : chunk.startsWith('> ')
          ? { kind: 'note', text: chunk.slice(2).trim() }
          : { kind: 'paragraph', text: chunk.replace(/\n/g, ' ') },
    );
}

/**
 * A legal page's text (K12): the current version from `LEGAL_DOCUMENT_VERSIONS`, or `?v=`'s earlier
 * one; in the page's language when translated, else in English with `translated` false.
 */
export function legalText(
  page: LegalPage,
  lang: string,
  requestedVersion: string | null,
  root = LEGAL_ROOT,
): LegalText | null {
  const folder = join(root, page);
  const versions = [
    ...new Set(
      readdirSync(folder)
        .map((file) => /^(\d{4}-\d{2}-\d{2})\.[a-z-]+\.md$/i.exec(file)?.[1])
        .filter((version): version is string => version !== undefined),
    ),
  ].sort((a, b) => b.localeCompare(a));
  const version =
    requestedVersion !== null && versions.includes(requestedVersion)
      ? requestedVersion
      : LEGAL_DOCUMENT_VERSIONS[LEGAL_PAGES[page]];
  const own = join(folder, `${version}.${lang}.md`);
  const english = join(folder, `${version}.en.md`);
  const file = existsSync(own) ? own : existsSync(english) ? english : null;
  if (file === null) return null;
  return {
    version,
    lang: file === own ? lang : 'en',
    translated: file === own,
    blocks: parseLegal(readFileSync(file, 'utf8')),
    versions,
  };
}
