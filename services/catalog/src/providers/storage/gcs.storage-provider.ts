import { Storage } from '@google-cloud/storage';
import type { Bucket } from '@google-cloud/storage';
import type { ReadinessCheck } from '@wayfare/nest-common';
import type { SignedUpload, StorageProvider, StoredObject } from './storage-provider';

/** How the GCS client is built (architecture §3.6). */
export interface GcsOptions {
  readonly bucket: string;
  /** Local only: the emulator's origin. */
  readonly apiEndpoint?: string;
  /** Local only: a service-account key file to sign with. Unset, ADC signs through IAM. */
  readonly keyFilename?: string;
}

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 404;

/** The only file that imports `@google-cloud/storage` (conventions §11.5). */
export class GcsStorageProvider implements StorageProvider {
  private readonly bucket: Bucket;

  constructor(options: GcsOptions) {
    const storage = new Storage({
      ...(options.apiEndpoint === undefined ? {} : { apiEndpoint: options.apiEndpoint }),
      ...(options.keyFilename === undefined ? {} : { keyFilename: options.keyFilename }),
    });
    this.bucket = storage.bucket(options.bucket);
  }

  async signUpload(input: {
    objectPath: string;
    contentType: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<SignedUpload> {
    const lengthRange = `0,${input.maxBytes}`;
    const [url] = await this.bucket.file(input.objectPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: input.expiresAt,
      contentType: input.contentType,
      extensionHeaders: { 'x-goog-content-length-range': lengthRange },
    });
    return {
      url,
      requiredHeaders: {
        'Content-Type': input.contentType,
        'x-goog-content-length-range': lengthRange,
      },
    };
  }

  async stat(objectPath: string): Promise<StoredObject | null> {
    try {
      const [metadata] = await this.bucket.file(objectPath).getMetadata();
      return { bytes: Number(metadata.size ?? 0) };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async download(objectPath: string): Promise<Buffer> {
    const [data] = await this.bucket.file(objectPath).download();
    return data;
  }

  async upload(
    objectPath: string,
    data: Buffer,
    options: { contentType: string; cacheControl: string },
  ): Promise<void> {
    await this.bucket.file(objectPath).save(data, {
      resumable: false,
      contentType: options.contentType,
      metadata: { cacheControl: options.cacheControl },
    });
  }

  async delete(objectPath: string): Promise<void> {
    await this.bucket.file(objectPath).delete({ ignoreNotFound: true });
  }

  readinessCheck(): ReadinessCheck {
    return {
      name: 'storage',
      check: async () => {
        const [exists] = await this.bucket.exists();
        if (!exists) throw new Error(`bucket ${this.bucket.name} does not exist`);
      },
    };
  }
}
