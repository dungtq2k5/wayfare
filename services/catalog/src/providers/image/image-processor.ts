import type { PhotoVariantName } from '@wayfare/contracts';

/** Injection token for the `ImageProcessor`. */
export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');

/** One generated WebP variant. */
export interface ProcessedVariant {
  readonly name: PhotoVariantName;
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

/** Why an image was refused. */
export type ImageRejection = 'TOO_LARGE' | 'UNREADABLE';

/** The outcome of processing one upload. */
export type ProcessedImage =
  | { readonly ok: true; readonly variants: readonly ProcessedVariant[] }
  | { readonly ok: false; readonly reason: ImageRejection };

/**
 * Image decoding and conversion (ADR 0022's pattern, rdm-spec C-12): orientation applied, every
 * piece of metadata stripped, WebP at each `PHOTO_VARIANT_WIDTHS` long edge.
 */
export interface ImageProcessor {
  /** Refuses an image over `maxPixels` before decoding it. */
  toVariants(input: Buffer, maxPixels: number): Promise<ProcessedImage>;
}
