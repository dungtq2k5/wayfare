import { colors } from '@wayfare/design-tokens/tokens';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('the web app on a Home Screen (WO1b)', () => {
  it('opens full screen on the map, in the tokens’ colours', () => {
    expect(manifest()).toMatchObject({
      name: 'Wayfare',
      start_url: '/map',
      display: 'standalone',
      background_color: colors.light.background,
      theme_color: colors.light.primary,
    });
  });
});
