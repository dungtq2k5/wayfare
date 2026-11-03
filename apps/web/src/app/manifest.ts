import { colors } from '@wayfare/design-tokens/tokens';
import type { MetadataRoute } from 'next';

/** The web app on a Home Screen (WO1b): it opens like an app, full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wayfare',
    short_name: 'Wayfare',
    description: "The stories of Ho Chi Minh City's places, told in your language.",
    start_url: '/map',
    display: 'standalone',
    background_color: colors.light.background,
    theme_color: colors.light.primary,
    icons: [{ src: '/icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
  };
}
