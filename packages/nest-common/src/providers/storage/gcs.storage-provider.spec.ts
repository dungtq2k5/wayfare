import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GcsStorageProvider } from './gcs.storage-provider';

/** A throwaway service-account key: signing is local, nothing is called. */
function keyFile(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const path = join(mkdtempSync(join(tmpdir(), 'gcs-key-')), 'key.json');
  writeFileSync(
    path,
    JSON.stringify({
      type: 'service_account',
      client_email: 'signer@wayfare-local.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  );
  return path;
}

const upload = {
  objectPath: 'uploads/01a00000-0000-7000-8000-000000000000/original',
  contentType: 'image/png',
  maxBytes: 5 * 1024 * 1024,
  expiresAt: new Date(Date.now() + 15 * 60_000),
};

describe('a signed upload', () => {
  const keyFilename = keyFile();

  it('names the emulator as the service reaches it, by default', async () => {
    const provider = new GcsStorageProvider({
      bucket: 'media',
      apiEndpoint: 'http://localhost:4443',
      keyFilename,
    });
    expect((await provider.signUpload(upload)).url).toMatch(
      /^http:\/\/localhost:4443\/media\/uploads\//,
    );
  });

  it('names the emulator as a browser reaches it, when the service reaches it by another name', async () => {
    const provider = new GcsStorageProvider({
      bucket: 'media',
      apiEndpoint: 'http://fake-gcs:4443',
      uploadEndpoint: 'http://localhost:4443',
      keyFilename,
    });
    const { url, requiredHeaders } = await provider.signUpload(upload);
    expect(url).toMatch(/^http:\/\/localhost:4443\/media\/uploads\//);
    expect(url).toContain('X-Goog-Signature=');
    expect(requiredHeaders['x-goog-content-length-range']).toBe(`0,${upload.maxBytes}`);
  });
});
