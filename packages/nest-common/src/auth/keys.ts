import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { z } from 'zod';

/** A `kid` header value: short, lower-case (architecture §14). */
export const zKeyId = z.string().regex(/^[a-z0-9-]{1,32}$/);

function decodePem(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8');
}

function asEd25519(key: KeyObject, ctx: z.RefinementCtx): KeyObject {
  if (key.asymmetricKeyType !== 'ed25519') {
    ctx.addIssue({ code: 'custom', message: 'Expected an Ed25519 key' });
    return z.NEVER;
  }
  return key;
}

/** `JWT_PRIVATE_KEY`: a base64-encoded PKCS#8 PEM, parsed at boot (ADR 0043). */
export const zPrivateKeyEnv = z
  .string()
  .min(1, 'Required — run `pnpm keys:dev` locally')
  .transform((value, ctx) => {
    try {
      return asEd25519(createPrivateKey(decodePem(value)), ctx);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Not a base64-encoded PKCS#8 PEM' });
      return z.NEVER;
    }
  });

/** `JWT_PUBLIC_KEYS`: JSON `{ "<kid>": "<base64 SPKI PEM>" }`, at least one entry (ADR 0043). */
export const zPublicKeysEnv = z
  .string()
  .min(1, 'Required — run `pnpm keys:dev` locally')
  .transform((value, ctx): ReadonlyMap<string, KeyObject> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Not JSON' });
      return z.NEVER;
    }
    const record = z.record(zKeyId, z.string().min(1)).safeParse(parsed);
    if (!record.success || Object.keys(record.data).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expected { "<kid>": "<base64 SPKI PEM>" } with at least one key',
      });
      return z.NEVER;
    }
    const keys = new Map<string, KeyObject>();
    for (const [kid, pem] of Object.entries(record.data)) {
      try {
        keys.set(kid, asEd25519(createPublicKey(decodePem(pem)), ctx));
      } catch {
        ctx.addIssue({ code: 'custom', message: `Key ${kid} is not a base64-encoded SPKI PEM` });
        return z.NEVER;
      }
    }
    return keys;
  });

/** A fresh Ed25519 pair in the env forms above — for tests; `pnpm keys:dev` writes the same forms. */
export interface EncodedSigningKeys {
  readonly keyId: string;
  /** `JWT_PRIVATE_KEY`. */
  readonly privateKey: string;
  /** `JWT_PUBLIC_KEYS`. */
  readonly publicKeys: string;
}

/** Generates an Ed25519 pair encoded as the env variables carry it. */
export function generateEncodedSigningKeys(keyId = 'test-key'): EncodedSigningKeys {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const encode = (pem: string | Buffer) => Buffer.from(pem.toString(), 'utf8').toString('base64');
  return {
    keyId,
    privateKey: encode(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    publicKeys: JSON.stringify({
      [keyId]: encode(publicKey.export({ type: 'spki', format: 'pem' })),
    }),
  };
}
