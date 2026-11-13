// Guard: every Maestro flow a flow, a feature's `system.sh` or `config.yaml` names exists
// (conventions §17.5), so a wrong path fails here and not an hour into a script on the phone.
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile, REPO_ROOT } from './support/repo';

const MAESTRO = 'apps/mobile/.maestro';

/** The flow files a file names, each relative to the folder its own paths resolve from. */
export function namedFlows(file: string, text: string): string[] {
  const lines = text.split('\n').filter((line) => !line.trimStart().startsWith('#'));
  const pattern = file.endsWith('.sh')
    ? /\bmaestro test\b.*?\s([\w./-]+\.yaml)\b/
    : file.endsWith('/config.yaml') || file === 'config.yaml'
      ? /^\s*-\s+([\w./-]+\.yaml)\s*$/
      : /^\s*(?:-\s+runFlow:|file:)\s*['"]?([\w./-]+\.yaml)/;
  return lines.flatMap((line) => {
    const name = pattern.exec(line)?.[1];
    return name === undefined ? [] : [name];
  });
}

/** Every named flow that is missing, as `file: name`. */
export function missingFlows(
  files: readonly string[],
  exists: (path: string) => boolean,
): string[] {
  return files.flatMap((file) =>
    namedFlows(file, readRepoFile(file))
      .filter((name) => !exists(posix.join(posix.dirname(file), name)))
      .map((name) => `${file}: ${name}`),
  );
}

describe('maestro paths', () => {
  it('name flows that exist', () => {
    const files = listFiles(`${MAESTRO}/**/*.yaml`, `${MAESTRO}/**/*.sh`);
    expect(files.length).toBeGreaterThan(50);
    expect(missingFlows(files, (path) => existsSync(join(REPO_ROOT, path)))).toEqual([]);
  });

  it('reads runFlow, file:, a script and config.yaml, but not comments', () => {
    expect(
      namedFlows(
        'f/a.yaml',
        "- runFlow: steps/x.yaml\n- runFlow:\n    file: '../common/y.yaml'\n# runFlow: z.yaml",
      ),
    ).toEqual(['steps/x.yaml', '../common/y.yaml']);
    expect(namedFlows('f/system.sh', "maestro test -e NAME='日本語' steps/to.yaml\n")).toEqual([
      'steps/to.yaml',
    ]);
    expect(namedFlows('config.yaml', 'flows:\n  - walk/walk.yaml\n')).toEqual(['walk/walk.yaml']);
  });
});
