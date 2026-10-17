// Guard: the mobile app's source folders keep their layers (conventions §12.6). A shared folder
// imports only shared folders; no two folders import each other. `import type` and JSON count.
import { posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile } from './support/repo';

const SRC = 'apps/mobile/src/';

/** Primitives and the local model: they may import only each other. Root files count as shared. */
const SHARED = new Set([
  'ui',
  'theme',
  'i18n',
  'db',
  'data',
  'sync',
  'network',
  'session',
  'state',
  'location',
  '(root)',
]);

/** A file's top-level folder under `src/`, or `(root)` for `env.ts` and `api.ts`. */
function folderOf(path: string): string {
  const slash = path.indexOf('/');
  return slash < 0 ? '(root)' : path.slice(0, slash);
}

/** Every folder-to-folder edge, with the files that make it: `from → to → ["a.ts -> b"]`. */
function edgesOf(files: ReadonlyMap<string, string>): Map<string, Map<string, string[]>> {
  const edges = new Map<string, Map<string, string[]>>();
  for (const [file, text] of files) {
    const from = folderOf(file);
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      if (!fileName.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(file), fileName));
      if (target.startsWith('..')) continue;
      const to = folderOf(target);
      if (to === from) continue;
      const byTarget = edges.get(from) ?? new Map<string, string[]>();
      byTarget.set(to, [...(byTarget.get(to) ?? []), `${file} -> ${target}`]);
      edges.set(from, byTarget);
    }
  }
  return edges;
}

/** Every layering problem, given the files under `src/` (paths relative to it) and their text. */
export function layerProblems(files: ReadonlyMap<string, string>): string[] {
  const edges = edgesOf(files);
  const problems: string[] = [];
  for (const [from, byTarget] of edges) {
    for (const [to, imports] of byTarget) {
      if (SHARED.has(from) && !SHARED.has(to)) {
        problems.push(`shared ${from}/ imports ${to}/: ${imports.join(', ')}`);
      }
      const back = edges.get(to)?.get(from);
      if (back !== undefined && from < to) {
        problems.push(`${from}/ and ${to}/ import each other: ${[...imports, ...back].join(', ')}`);
      }
    }
  }
  return problems;
}

function corpus(): Map<string, string> {
  return new Map(
    listFiles(`${SRC}**/*.ts`, `${SRC}**/*.tsx`, `${SRC}*.ts`)
      .filter((file) => !/\.spec\.tsx?$/.test(file))
      .map((file) => [file.slice(SRC.length), readRepoFile(file)]),
  );
}

describe('mobile layers', () => {
  it('hold in apps/mobile/src', () => {
    expect(layerProblems(corpus())).toEqual([]);
  });

  it('reports a shared folder importing a feature, and a mutual pair', () => {
    const problems = layerProblems(
      new Map([
        ['ui/row.tsx', "import type { Place } from '../places/place';"],
        ['places/place.ts', "import data from '../map/icons.json';"],
        ['map/sheet.tsx', "import { Row } from '../places/row';"],
        ['env.ts', "import { api } from './api';"],
      ]),
    );
    expect(problems).toEqual([
      'shared ui/ imports places/: ui/row.tsx -> places/place',
      'map/ and places/ import each other: map/sheet.tsx -> places/row, places/place.ts -> map/icons.json',
    ]);
  });
});
