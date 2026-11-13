// Builds dist/ from tokens.json (the designer's export; replaced, never hand-edited).
import StyleDictionary from 'style-dictionary';
import { formats } from './build/formats.mjs';

// Two modes share leaf names (semantic.light.color.primary, semantic.dark.color.primary): the full
// path is the name, so Style Dictionary sees no collision.
StyleDictionary.registerTransform({
  name: 'wayfare/name',
  type: 'name',
  transform: (token) => token.path.join('.'),
});

for (const [name, format] of Object.entries(formats))
  StyleDictionary.registerFormat({ name, format });

export default {
  source: ['tokens.json'],
  usesDtcg: true,
  log: { verbosity: 'default' },
  platforms: {
    // One platform: the formats read the resolved tokens and convert units themselves, per output.
    all: {
      transforms: ['wayfare/name'],
      buildPath: 'dist/',
      files: [
        { destination: 'nativewind-preset.js', format: 'wayfare/nativewind-preset' },
        { destination: 'tokens.js', format: 'wayfare/values' },
        { destination: 'tokens.d.ts', format: 'wayfare/values-d-ts' },
        { destination: 'web.css', format: 'wayfare/web-css' },
      ],
    },
  },
};
