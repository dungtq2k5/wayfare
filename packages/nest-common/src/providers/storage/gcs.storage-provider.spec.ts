import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

describe('the bucket’s objects', () => {
  /** A provider on production's options, its bucket the given fake: nothing is called. */
  function withBucket(bucket: Record<string, unknown>): GcsStorageProvider {
    const provider = new GcsStorageProvider({ bucket: 'media' });
    (provider as unknown as { bucket: unknown }).bucket = { name: 'media', ...bucket };
    return provider;
  }
  const file = (methods: Record<string, unknown>) => ({ file: vi.fn(() => methods) });

  it('stats an object by its size, a missing size as zero, and a missing object as none', async () => {
    const getMetadata = vi
      .fn()
      .mockResolvedValueOnce([{ size: '42' }])
      .mockResolvedValueOnce([{}])
      .mockRejectedValueOnce({ code: 404 });
    const provider = withBucket(file({ getMetadata }));
    expect(await provider.stat('a')).toEqual({ bytes: 42 });
    expect(await provider.stat('a')).toEqual({ bytes: 0 });
    expect(await provider.stat('a')).toBeNull();
  });

  it('lets any other failure to stat through', async () => {
    for (const failure of [{ code: 500 }, null, 'boom']) {
      const provider = withBucket(file({ getMetadata: vi.fn().mockRejectedValue(failure) }));
      await expect(provider.stat('a')).rejects.toBe(failure);
    }
  });

  it('downloads, streams, uploads uncached-resumable and deletes ignoring a missing object', async () => {
    const data = Buffer.from('x');
    const stream = {};
    const methods = {
      download: vi.fn(() => Promise.resolve([data])),
      createReadStream: vi.fn(() => stream),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    const provider = withBucket(file(methods));
    expect(await provider.download('a')).toBe(data);
    expect(provider.read('a')).toBe(stream);
    expect(methods.createReadStream).toHaveBeenCalledWith({ validation: false });
    await provider.upload('a', data, { contentType: 'audio/mpeg', cacheControl: 'no-store' });
    expect(methods.save).toHaveBeenCalledWith(data, {
      resumable: false,
      contentType: 'audio/mpeg',
      metadata: { cacheControl: 'no-store' },
    });
    await provider.delete('a');
    expect(methods.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('lists a prefix with each object’s creation time, an unknown one as the epoch', async () => {
    const getFiles = vi.fn(() =>
      Promise.resolve([
        [
          { name: 'p/a', metadata: { timeCreated: '2026-11-01T00:00:00.000Z' } },
          { name: 'p/b', metadata: {} },
        ],
      ]),
    );
    expect(await withBucket({ getFiles }).list('p/')).toEqual([
      { path: 'p/a', createdAt: new Date('2026-11-01T00:00:00.000Z') },
      { path: 'p/b', createdAt: new Date(0) },
    ]);
    expect(getFiles).toHaveBeenCalledWith({ prefix: 'p/', autoPaginate: true });
  });

  it('is ready only while the bucket exists', async () => {
    const exists = vi.fn().mockResolvedValueOnce([true]).mockResolvedValueOnce([false]);
    const { name, check } = withBucket({ exists }).readinessCheck();
    expect(name).toBe('storage');
    await expect(check()).resolves.toBeUndefined();
    await expect(check()).rejects.toThrow('bucket media does not exist');
  });
});
