import { describe, expect, it } from 'vitest';
import { createWalkLog, dropOldestHalf } from './walk-log';
import type { LogFile } from './walk-log';

function memory(): LogFile & { text: string } {
  const file = {
    text: '',
    size: () => new TextEncoder().encode(file.text).length,
    append: (line: string) => {
      file.text += line;
      return Promise.resolve();
    },
    read: () => Promise.resolve(file.text),
    write: (text: string) => {
      file.text = text;
      return Promise.resolve();
    },
  };
  return file;
}

const parse = (text: string) =>
  text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as { n: number });

describe('the walk log', () => {
  it('writes one JSON line per event, in order', async () => {
    const file = memory();
    const log = createWalkLog(file);
    void log.append({ n: 1 });
    await log.append({ n: 2 });
    expect(parse(file.text)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('rolls at the limit, dropping the oldest half and keeping whole lines', async () => {
    const file = memory();
    const log = createWalkLog(file, 200);
    for (let n = 0; n < 40; n += 1) await log.append({ n });
    const lines = parse(file.text);
    expect(file.size()).toBeLessThanOrEqual(200);
    expect(lines.at(-1)).toEqual({ n: 39 });
    expect(lines[0]!.n).toBeGreaterThan(0);
  });

  it('survives a failing file', async () => {
    const file = { ...memory(), append: () => Promise.reject(new Error('disk')) };
    await expect(createWalkLog(file).append({ n: 1 })).resolves.toBeUndefined();
  });

  it('drops to nothing when there is no line boundary to cut at', () => {
    expect(dropOldestHalf('abcdef')).toBe('');
  });
});
