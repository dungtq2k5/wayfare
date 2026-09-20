import type { Readable } from 'node:stream';
import type { ReadinessCheck } from '../../health/readiness';

/** Injection token for the media `StorageProvider`. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/** A signed browser upload: where to PUT, and the headers the PUT must carry exactly. */
export interface SignedUpload {
  readonly url: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
}

/** What storage knows about an object. */
export interface StoredObject {
  readonly bytes: number;
}

/** One listed object: its path and when it was written. */
export interface ListedObject {
  readonly path: string;
  readonly createdAt: Date;
}

/**
 * Object storage, as catalog uses it (ADR 0022). GCS is one implementation; nothing outside
 * `src/providers/storage/` knows which.
 */
export interface StorageProvider {
  /** A V4 signed `PUT` bound to the content type and a `0..maxBytes` length range. */
  signUpload(input: {
    readonly objectPath: string;
    readonly contentType: string;
    readonly maxBytes: number;
    readonly expiresAt: Date;
  }): Promise<SignedUpload>;
  /** The object's size, or null when it does not exist. */
  stat(objectPath: string): Promise<StoredObject | null>;
  /** The whole object. The caller checks its size first. */
  download(objectPath: string): Promise<Buffer>;
  /** The object as a stream, for reading one too large to hold (a map pack's archive). */
  read(objectPath: string): Readable;
  /** Every object under a prefix, with when it was written. */
  list(prefix: string): Promise<ListedObject[]>;
  /** Writes an object, replacing any at the path. */
  upload(
    objectPath: string,
    data: Buffer,
    options: { readonly contentType: string; readonly cacheControl: string },
  ): Promise<void>;
  /** Deletes an object; a missing one is not an error. */
  delete(objectPath: string): Promise<void>;
  /** Readiness: the bucket answers. */
  readinessCheck(): ReadinessCheck;
}
