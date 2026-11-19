import { describe, expect, it, vi } from 'vitest';

const loaders = vi.hoisted(() => {
  const calls: { family: string; options: { preload?: boolean; variable: string } }[] = [];
  const loader = (family: string) => (options: { preload?: boolean; variable: string }) => {
    calls.push({ family, options });
    return { variable: options.variable };
  };
  return { calls, loader };
});
vi.mock('next/font/local', () => ({ default: loaders.loader('Be Vietnam Pro') }));
vi.mock('next/font/google', () => ({
  JetBrains_Mono: loaders.loader('JetBrains Mono'),
  Noto_Sans_JP: loaders.loader('Noto Sans JP'),
  Noto_Sans_KR: loaders.loader('Noto Sans KR'),
  Noto_Sans_SC: loaders.loader('Noto Sans SC'),
  Noto_Sans_TC: loaders.loader('Noto Sans TC'),
}));

const { FONT_VARIABLES } = await import('./fonts');

describe('the web’s fonts (round 29)', () => {
  it('gives the document every family’s variable', () => {
    expect(FONT_VARIABLES.split(' ')).toEqual([
      '--font-be-vietnam-pro',
      '--font-jetbrains-mono',
      '--font-noto-jp',
      '--font-noto-kr',
      '--font-noto-sc',
      '--font-noto-tc',
    ]);
  });

  it('never preloads the scripts Be Vietnam Pro lacks: a page in English fetches none', () => {
    const noto = loaders.calls.filter(({ family }) => family.startsWith('Noto'));
    expect(noto).toHaveLength(4);
    expect(noto.every(({ options }) => options.preload === false)).toBe(true);
  });
});
