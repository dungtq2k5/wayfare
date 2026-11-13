// Orval's tags-split mode writes one folder per tag and no entry point: this lists them, so the
// package has one index and a new tag needs no hand edit.
import { readdirSync, writeFileSync } from 'node:fs';

const generated = new URL('../src/generated/', import.meta.url);
const tags = readdirSync(generated, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'model')
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

const lines = [
  '// Written by scripts/write-index.mjs. Do not edit manually.',
  "export * from './model';",
  ...tags.map((tag) => `export * from './${tag}/${tag}';`),
];
writeFileSync(new URL('index.ts', generated), `${lines.join('\n')}\n`);
