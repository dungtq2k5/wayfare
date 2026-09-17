#!/usr/bin/env node
// pnpm keys:dev — generates an Ed25519 signing pair for local development and CI (ADR 0043).
// Writes JWT_PRIVATE_KEY and JWT_KEY_ID into services/identity/.env and JWT_PUBLIC_KEYS into
// services/gateway/.env, replacing only those lines. Never for production keys.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.NODE_ENV === 'production') {
  console.error(
    'keys:dev refuses to run with NODE_ENV=production — production keys come from the secret store.',
  );
  process.exit(1);
}

const root = resolve(import.meta.dirname, '../../..');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const base64 = (pem) => Buffer.from(pem, 'utf8').toString('base64');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const keyId = `dev-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;

/** Sets `key=value` in an env file: replaces the line when present, appends it otherwise. */
function setEnv(file, entries) {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    console.error(`${file} is missing — copy its .env.example first.`);
    process.exit(1);
  }
  let text = readFileSync(path, 'utf8');
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text)
      ? text.replace(pattern, () => line)
      : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }
  writeFileSync(path, text);
  console.log(`✓ ${file}: ${Object.keys(entries).join(', ')}`);
}

setEnv('services/identity/.env', { JWT_PRIVATE_KEY: base64(privatePem), JWT_KEY_ID: keyId });
// Single-quoted: the JSON holds double quotes, and both dotenv and node --env-file accept it.
setEnv('services/gateway/.env', {
  JWT_PUBLIC_KEYS: `'${JSON.stringify({ [keyId]: base64(publicPem) })}'`,
});
