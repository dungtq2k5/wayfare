// Guard: what the coverage figure leaves out is written once, in vitest.config.mts, and
// SonarCloud's coverage exclusions say the same, so its figure is CI's (architecture §12,
// conventions §17.4).
import { join, matchesGlob } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listFiles, readRepoFile, REPO_ROOT } from './support/repo';

interface CoverageLists {
  coverageInclude: string[];
  coverageExclude: string[];
}

/** `sonar.<key>`'s globs, across the file's `\` line continuations. */
function sonarGlobs(key: string): string[] {
  const properties = readRepoFile('sonar-project.properties').replaceAll(/\\\n/g, '');
  const line = properties.split('\n').find((row) => row.startsWith(`sonar.${key}=`));
  if (!line) throw new Error(`sonar.${key} not found`);
  return line
    .slice(`sonar.${key}=`.length)
    .split(',')
    .map((glob) => glob.trim())
    .filter((glob) => glob.length > 0);
}

const matchesAny = (file: string, globs: readonly string[]): boolean =>
  globs.some((glob) => matchesGlob(file, glob));

const CODE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const code = listFiles().filter((file) => CODE.test(file));
const sonarCoverage = sonarGlobs('coverage.exclusions');
const sonarSources = sonarGlobs('exclusions');

describe('coverage exclusions', () => {
  let lists: CoverageLists;

  beforeAll(async () => {
    // Loaded at run time: a static import would type-check Vite's config types from this package.
    lists = (await import(join(REPO_ROOT, 'vitest.config.mts'))) as CoverageLists;
  });

  /** Vitest's include globs are relative to each project's root: `apps/console`, `services/…`. */
  const measured = (file: string): boolean => {
    const [top, name, ...rest] = file.split('/');
    if (!['apps', 'services', 'packages'].includes(top ?? '') || !name || rest.length === 0)
      return false;
    return (
      matchesAny(rest.join('/'), lists.coverageInclude) && !matchesAny(file, lists.coverageExclude)
    );
  };

  it('names each of vitest.config.mts’s exclusions in SonarCloud’s', () => {
    expect(lists.coverageExclude.filter((glob) => !sonarCoverage.includes(glob))).toEqual([]);
  });

  it('leave out, in SonarCloud, nothing the merged report counts', () => {
    const extra = sonarCoverage.filter((glob) => !lists.coverageExclude.includes(glob));
    expect(code.filter((file) => measured(file) && matchesAny(file, extra))).toEqual([]);
  });

  it('leave out, in SonarCloud, everything the merged report doesn’t count', () => {
    const counted = code.filter(
      (file) =>
        !measured(file) && !matchesAny(file, sonarCoverage) && !matchesAny(file, sonarSources),
    );
    expect(counted).toEqual([]);
  });
});
