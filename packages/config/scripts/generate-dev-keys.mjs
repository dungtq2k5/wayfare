#!/usr/bin/env node
// pnpm keys:dev — generates an Ed25519 signing pair for local development and CI (ADR 0043).
// Writes JWT_PRIVATE_KEY and JWT_KEY_ID into services/identity/.env and JWT_PUBLIC_KEYS into
// services/gateway/.env, replacing only those lines. EMAIL_HASH_KEY and PII_ENCRYPTION_KEY are
// written only when absent or empty: a new key would stop every stored address hash from matching,
// and would make every stored national ID undecryptable. billing's STRIPE_WEBHOOK_SECRET is written
// the same way, only when absent: the local walks sign Stripe events with it, and a sandbox's
// `stripe listen` secret, once pasted in, must never be replaced. catalog gets a
// throwaway service-account key to sign upload URLs against the storage emulator (architecture
// §3.6), written once to services/catalog/.keys/ and named by GOOGLE_APPLICATION_CREDENTIALS in
// catalog's and narration's .env.
// Never for production keys.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

const identityPath = resolve(root, 'services/identity/.env');
const identityEnv = existsSync(identityPath) ? readFileSync(identityPath, 'utf8') : '';
const hasHashKey = /^EMAIL_HASH_KEY=.+$/m.test(identityEnv);
const hasPiiKey = /^PII_ENCRYPTION_KEY=.+$/m.test(identityEnv);
setEnv('services/identity/.env', {
  JWT_PRIVATE_KEY: base64(privatePem),
  JWT_KEY_ID: keyId,
  ...(hasHashKey ? {} : { EMAIL_HASH_KEY: randomBytes(32).toString('base64') }),
  ...(hasPiiKey ? {} : { PII_ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
});
// Single-quoted: the JSON holds double quotes, and both dotenv and node --env-file accept it.
setEnv('services/gateway/.env', {
  JWT_PUBLIC_KEYS: `'${JSON.stringify({ [keyId]: base64(publicPem) })}'`,
});

// A service-account-shaped key: the storage client only signs with it, and the emulator never checks.
const gcsKeyPath = resolve(root, 'services/catalog/.keys/gcs-dev.json');
if (!existsSync(gcsKeyPath)) {
  const { privateKey: rsaKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  mkdirSync(dirname(gcsKeyPath), { recursive: true });
  const key = {
    type: 'service_account',
    project_id: 'wayfare-local',
    private_key_id: randomBytes(20).toString('hex'),
    private_key: rsaKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    client_email: 'catalog@wayfare-local.iam.gserviceaccount.com',
    client_id: randomUUID(),
    token_uri: 'https://oauth2.googleapis.com/token',
  };
  writeFileSync(gcsKeyPath, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  console.log('✓ services/catalog/.keys/gcs-dev.json');
}
// billing verifies Stripe webhooks with a secret even without an API key (architecture §5).
const billingPath = resolve(root, 'services/billing/.env');
const billingEnv = existsSync(billingPath) ? readFileSync(billingPath, 'utf8') : '';
if (!/^STRIPE_WEBHOOK_SECRET=.+$/m.test(billingEnv)) {
  setEnv('services/billing/.env', {
    STRIPE_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString('base64url')}`,
  });
}

// narration writes audio to the same bucket, with the same throwaway key.
setEnv('services/catalog/.env', { GOOGLE_APPLICATION_CREDENTIALS: gcsKeyPath });
setEnv('services/narration/.env', { GOOGLE_APPLICATION_CREDENTIALS: gcsKeyPath });
