// The web's spacing lint (ADR 0061): each kind of spacing class, allowed on the token scale and
// refused off it.
import { describe, expect, it } from 'vitest';
import { OFF_SCALE_SPACING, SPACE_STEPS } from '../spacing-scale.mjs';

const offScale = new RegExp(OFF_SCALE_SPACING, 'g');
const refused = (classes: string) => classes.match(offScale)?.map((match) => match.trim()) ?? [];

describe('the web spacing lint', () => {
  it('reads the scale from the tokens, the 2 px half-step among it', () => {
    expect(SPACE_STEPS).toEqual(['0', '0.5', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16']);
  });

  it.each([
    ['padding', 'p-4 px-2 py-0.5 pt-3 pl-8 pe-6', 'p-7 px-2.5 py-1.5 pl-9'],
    ['margin', 'm-0 mx-auto -mt-2 mb-16 ms-1', 'm-7 mt-1.5 -mb-11 me-9'],
    ['gap', 'gap-2 gap-x-3 gap-y-0.5', 'gap-1.5 gap-x-7 gap-y-14'],
    ['space between', 'space-x-2 space-y-4', 'space-x-1.5 space-y-9'],
    [
      'position',
      'inset-0 inset-x-4 top-1 left-1/2 -right-2 bottom-full',
      'inset-7 top-11 left-2.5',
    ],
  ])('%s: allows %j, refuses %j', (_kind, allowed, off) => {
    expect(refused(allowed)).toEqual([]);
    expect(refused(off)).toEqual(off.split(' '));
  });

  it('leaves sizes and variants alone', () => {
    expect(refused('w-80 h-9 size-7 md:px-6 lg:pl-8 border-t-2 z-10 text-2xl')).toEqual([]);
    expect(refused('md:gap-7 sm:-mx-9')).toEqual(['gap-7', '-mx-9']);
  });
});
