import { describe, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() =>
  vi.fn((options: { variable: string }) => ({ variable: options.variable })),
);
vi.mock('next/font/local', () => ({ default: loader }));

const { beVietnamPro } = await import('./fonts');

describe('the console’s font', () => {
  it('is Be Vietnam Pro, its four weights from the design tokens, swapped in', () => {
    expect(beVietnamPro.variable).toBe('--font-be-vietnam-pro');
    const [options] = loader.mock.calls[0]!;
    expect(options).toMatchObject({ display: 'swap' });
    expect(
      (options as unknown as { src: { weight: string }[] }).src.map((face) => face.weight),
    ).toEqual(['400', '500', '600', '700']);
  });
});
