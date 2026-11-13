import { PHOTO_VARIANT_WIDTHS } from '@wayfare/contracts';
import type { PhotoVariantName } from '@wayfare/contracts';
import sharp from 'sharp';
import type { ImageProcessor, ProcessedImage, ProcessedVariant } from './image-processor';

/** WebP quality for every variant (rdm-spec C-12). */
export const WEBP_QUALITY = 80;

/**
 * The only file that imports `sharp` (conventions §11.5). One libvips thread per operation: the
 * uploads service bounds how many run at once, so memory stays bounded too.
 */
export class SharpImageProcessor implements ImageProcessor {
  constructor() {
    sharp.concurrency(1);
    // No cache: each upload is decoded once and its buffers are dropped straight after.
    sharp.cache(false);
  }

  async toVariants(input: Buffer, maxPixels: number): Promise<ProcessedImage> {
    let width: number;
    let height: number;
    try {
      // The header only — nothing is decoded yet.
      const metadata = await sharp(input, { limitInputPixels: false }).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch {
      return { ok: false, reason: 'UNREADABLE' };
    }
    if (width * height > maxPixels) return { ok: false, reason: 'TOO_LARGE' };

    try {
      const variants: ProcessedVariant[] = [];
      for (const [name, edge] of Object.entries(PHOTO_VARIANT_WIDTHS) as [
        PhotoVariantName,
        number,
      ][]) {
        // No withMetadata(): EXIF, GPS, XMP and ICC are all dropped; rotate() applies orientation first.
        const { data, info } = await sharp(input, { limitInputPixels: maxPixels, failOn: 'error' })
          .rotate()
          .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer({ resolveWithObject: true });
        variants.push({ name, data, width: info.width, height: info.height });
      }
      return { ok: true, variants };
    } catch {
      return { ok: false, reason: 'UNREADABLE' };
    }
  }
}
