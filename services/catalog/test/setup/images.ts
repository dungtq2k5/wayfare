// Image fixtures, generated deterministically at test time rather than committed as binaries.
import { crc32 } from 'node:zlib';
import sharp from 'sharp';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });

/**
 * A 1200×900 JPEG a phone would send: a GPS position in its EXIF, an ICC profile, and an
 * orientation tag saying "rotate 90°".
 */
export function phoneJpeg(): Promise<Buffer> {
  return solid(1200, 900)
    .jpeg({ quality: 90 })
    .keepIccProfile()
    .withExif({
      IFD0: { Make: 'PhoneCo', Model: 'Pocket 9' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '10/1 46/1 21/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '106/1 41/1 53/1',
      },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** A small PNG. */
export function smallPng(): Promise<Buffer> {
  return solid(64, 48).png().toBuffer();
}

/** A small WebP. */
export function smallWebp(): Promise<Buffer> {
  return solid(400, 300).webp().toBuffer();
}

/** Bytes with a JPEG signature, `bytes` long — over the limit when asked. */
export function oversized(bytes: number): Buffer {
  const data = Buffer.alloc(bytes, 0x41);
  data.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return data;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A tiny PNG whose header declares `width × height` — a decompression bomb's shape. */
export function hugeCanvasPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
