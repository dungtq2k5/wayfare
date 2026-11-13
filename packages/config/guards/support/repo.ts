// Shared plumbing for the guard specs (conventions §17.4).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The repository root. Every git call runs from here: the Vitest project's root is
 * `packages/config`, and `git ls-files` from there would list only that package.
 */
const repoRootOptions = { cwd: __dirname, encoding: 'utf8' } as const;
export const REPO_ROOT = execFileSync(
  'git', // NOSONAR: S4036, guard tooling runs the developer's own git
  ['rev-parse', '--show-toplevel'],
  repoRootOptions,
).trim();

/**
 * Tracked and untracked-but-not-ignored files matching the pathspecs, repo-relative. Ignored files
 * (the docs scratch folder, `generated/`, `dist/`) never appear; deleted-but-staged files are dropped.
 */
export function listFiles(...pathspecs: string[]): string[] {
  const output = execFileSync(
    'git', // NOSONAR: S4036, guard tooling runs the developer's own git
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...pathspecs],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const files = output.split('\0').filter((path) => path.length > 0);
  return [...new Set(files)].filter((path) => existsSync(join(REPO_ROOT, path)));
}

/** Reads a repo-relative file as UTF-8. */
export function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** `boost-expire` → `BoostExpire`. */
export function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** The body of a `## N.` section, up to the next `## `. */
export function section(markdown: string, number: number): string {
  const start = markdown.search(new RegExp(String.raw`^## ${number}\. `, 'm'));
  if (start < 0) throw new Error(`section §${number} not found`);
  const rest = markdown.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? markdown.slice(start) : markdown.slice(start, start + 1 + end);
}

/** Every table row's cells, in order, skipping the header separator. */
export function tableRows(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*:?-/.test(line))
    .map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

/** Markdown `##` headings, skipping fenced code blocks. */
export function sectionHeadings(markdown: string): string[] {
  const headings: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker.charAt(0);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence === null && line.startsWith('## ')) headings.push(line.slice(3).trim());
  }
  return headings;
}
