// Draws the map's category markers: each category's Lucide glyph on the `map-marker` disc inside the
// `card` ring, once per appearance, in the design tokens' colors. The map takes images, not views
// (MapLibre `Images`), so they are generated here: `pnpm --filter @wayfare/mobile markers`.
// Writes assets/map/marker-<CATEGORY>-<mode>.png and src/map/generated/marker-images.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { colors } = require('@wayfare/design-tokens/tokens');
const icons = JSON.parse(
  readFileSync(new URL('../src/map/category-icons.json', import.meta.url), 'utf8'),
);
const lucide = new URL('../node_modules/lucide-react-native/dist/esm/icons/', import.meta.url);
const assets = new URL('../assets/map/', import.meta.url);
mkdirSync(assets, { recursive: true });
mkdirSync(new URL('../src/map/generated/', import.meta.url), { recursive: true });

/** A Lucide icon's drawing: the shapes in its module's `node` array, as [tag, attributes] pairs. */
function iconNodes(name) {
  const source = readFileSync(new URL(`${name}.mjs`, lucide), 'utf8');
  const shapes = source.slice(source.indexOf('node: ['));
  return [
    ...shapes.matchAll(/"(path|circle|rect|line|polyline|polygon|ellipse)",\s+\{([^}]*)\}/g),
  ].map(([, tag, body]) => [
    tag,
    // The attributes are an object literal with bare keys: quote them, and it is JSON.
    JSON.parse(`{${body.replaceAll(/([\w-]+):/g, '"$1":')}}`), // NOSONAR: S8786, a few hundred characters of a vendored icon
  ]);
}

const SIZE = 120; // 40 dp at 3x; the layer draws it at one third
const glyph = (name, stroke) =>
  iconNodes(name)
    .map(([tag, { key: _key, ...attributes }]) => {
      const attrs = Object.entries(attributes)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrs} fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');

const files = [];
for (const mode of ['light', 'dark']) {
  const palette = colors[mode];
  for (const [category, name] of Object.entries(icons)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
      <circle cx="60" cy="60" r="59" fill="${palette.card}"/>
      <circle cx="60" cy="60" r="52" fill="${palette['map-marker']}"/>
      <g transform="translate(30 30) scale(2.5)">${glyph(name, palette['map-marker-foreground'])}</g></svg>`;
    const file = `marker-${category}-${mode}.png`;
    await sharp(Buffer.from(svg)).png().toFile(new URL(file, assets).pathname);
    files.push({ key: `${category}-${mode}`, file });
  }
}

const lines = [
  '// Written by scripts/build-marker-images.mjs. Do not edit.',
  'export const MARKER_IMAGES = {',
  ...files.map(({ key, file }) => `  '${key}': require('../../../assets/map/${file}') as number,`),
  '} as const;',
  '',
];
writeFileSync(new URL('../src/map/generated/marker-images.ts', import.meta.url), lines.join('\n'));
