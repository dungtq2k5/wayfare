import { describe, expect, it } from 'vitest';
import { photoRefusal } from './uploads';

const MB = 1024 * 1024;

describe('a photo checked before uploading (K9)', () => {
  it('refuses a HEIC by its type or its name, before anything is sent', () => {
    expect(photoRefusal({ name: 'IMG_1.HEIC', type: '', size: MB })?.code).toBe('UPLOAD_HEIC');
    expect(photoRefusal({ name: 'stall.jpg', type: 'image/heic', size: MB })?.code).toBe(
      'UPLOAD_HEIC',
    );
    expect(photoRefusal({ name: 'stall.heif', type: 'image/heif', size: MB })?.code).toBe(
      'UPLOAD_HEIC',
    );
  });

  it('refuses another type and a photo over 5 MB, and passes a JPEG under it', () => {
    expect(photoRefusal({ name: 'menu.pdf', type: 'application/pdf', size: MB })?.code).toBe(
      'UPLOAD_TYPE_MISMATCH',
    );
    const large = photoRefusal({ name: 'big.jpg', type: 'image/jpeg', size: 7 * MB });
    expect(large?.code).toBe('UPLOAD_TOO_LARGE');
    expect(large?.details).toEqual({ size: 7 });
    expect(photoRefusal({ name: 'stall.jpg', type: 'image/jpeg', size: MB })).toBeNull();
  });
});
