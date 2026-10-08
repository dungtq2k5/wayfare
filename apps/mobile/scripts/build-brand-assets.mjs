// Draws the app icon layers and the splash marks from the Figma mark (Brand page, node 14:3) in the
// design tokens' colors. Run it after a brand or color change: `pnpm --filter @wayfare/mobile brand`.
// The icon's background is not drawn here: app.config.ts takes it from the tokens.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { colors } = require('@wayfare/design-tokens/tokens');
const OUT = new URL('../assets/brand/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const LANTERN = '#E29227'; // lantern/400, the voice dot (map-marker-selected in light)

/** The mark, in a 48-unit box: pin, voice dot, two sound waves (Figma `logo/mark`). */
function mark({ pin, dot, waves }) {
  const wave = (d) =>
    `<path d="${d}" stroke="${waves}" stroke-width="3.2" stroke-linecap="round" fill="none"/>`;
  return `
    <path d="M18 9C20.9174 9 23.7153 10.1589 25.7782 12.2218C27.8411 14.2847 29 17.0826 29 20C29 28 18 42 18 42C18 42 7 28 7 20C7 17.0826 8.15893 14.2847 10.2218 12.2218C12.2847 10.1589 15.0826 9 18 9Z" fill="${pin}"/>
    <circle cx="18" cy="20" r="4.5" fill="${dot}"/>
    ${wave('M32.4 11C34.0847 13.6996 34.9778 16.8179 34.9778 20C34.9778 23.1821 34.0847 26.3004 32.4 29')}
    ${wave('M37.5 7.80005C39.7887 11.4577 41.0023 15.6854 41.0023 20C41.0023 24.3147 39.7887 28.5424 37.5 32.2001')}`;
}

/** The mark centred on a square canvas, `fraction` of its side wide. */
function canvas(size, fraction, parts, background) {
  const scale = (size * fraction) / 48;
  const offset = (size - 48 * scale) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${background === undefined ? '' : `<rect width="${size}" height="${size}" fill="${background}"/>`}
    <g transform="translate(${offset} ${offset}) scale(${scale})">${parts}</g></svg>`);
}

const png = (name, svg) => sharp(svg).png().toFile(new URL(name, OUT).pathname);

// Adaptive icon: 108 dp at 4x, the mark inside the 66 dp safe zone.
await png(
  'icon-foreground.png',
  canvas(432, 66 / 108, mark({ pin: '#FFFFFF', dot: LANTERN, waves: '#FFFFFF' })),
);
// Monochrome layer (Android's themed icons tint it): one colour, the voice dot cut out.
await png(
  'icon-monochrome.png',
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 432 432"><defs><mask id="m"><rect width="48" height="48" fill="white"/><circle cx="18" cy="20" r="4.5" fill="black"/></mask></defs>
     <g transform="translate(84 84) scale(${264 / 48})"><g mask="url(#m)">${mark({ pin: '#000000', dot: '#000000', waves: '#000000' })}</g></g></svg>`,
  ),
);
// Splash: the mark at 96 dp (384 px for sharpness), jade/700 on light and jade/300 on dark.
await png(
  'splash-mark-light.png',
  canvas(384, 1, mark({ pin: colors.light.primary, dot: LANTERN, waves: colors.light.primary })),
);
await png(
  'splash-mark-dark.png',
  canvas(384, 1, mark({ pin: colors.dark.primary, dot: LANTERN, waves: colors.dark.primary })),
);
// The store and fallback icon: the layers composed on the token background.
await png(
  'icon.png',
  canvas(
    1024,
    66 / 108,
    mark({ pin: '#FFFFFF', dot: LANTERN, waves: '#FFFFFF' }),
    colors.light.primary,
  ),
);
