import { ApiError } from '@wayfare/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  uploadsCreate: vi.fn(),
  uploadsConfirm: vi.fn(),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

const { UploadRefused, uploadPhoto } = await import('./uploads');

/** The storage `PUT`, as far as the upload uses it: the test says how it ends. */
class FakeRequest {
  static last: FakeRequest | null = null;
  static outcome: { status: number } | 'error' = { status: 200 };
  static progress: { lengthComputable: boolean; loaded: number; total: number }[] = [];
  method = '';
  url = '';
  status = 0;
  headers: Record<string, string> = {};
  sent: unknown = null;
  upload: {
    onprogress:
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
    for (const event of FakeRequest.progress) this.upload.onprogress?.(event);
    if (FakeRequest.outcome === 'error') this.onerror?.();
    else {
      this.status = FakeRequest.outcome.status;
      this.onload?.();
    }
  }
}

const photo = { name: 'stall.jpg', type: 'image/jpeg', size: 1024 } as File;
const signed = {
  data: {
    uploadId: 'up1',
    uploadUrl: 'https://storage.test/put',
    requiredHeaders: { 'content-type': 'image/jpeg', 'x-goog-meta': 'm' },
  },
};
const confirmed = {
  data: {
    variants: {
      thumb: { url: 'https://media.test/thumb' },
      card: { url: 'https://media.test/card' },
    },
  },
};

describe('one photo through the uploads (K4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    FakeRequest.outcome = { status: 200 };
    FakeRequest.progress = [];
    api.uploadsCreate.mockResolvedValue(signed);
    api.uploadsConfirm.mockResolvedValue(confirmed);
  });

  it('refuses a photo the API would, before anything is sent', async () => {
    await expect(uploadPhoto({ ...photo, type: 'image/gif' })).rejects.toMatchObject({
      code: 'UPLOAD_TYPE_MISMATCH',
    });
    expect(api.uploadsCreate).not.toHaveBeenCalled();
  });

  it('signs, puts it with exactly the headers asked for, confirms, and shows its thumbnail', async () => {
    const percents: number[] = [];
    FakeRequest.progress = [
      { lengthComputable: false, loaded: 0, total: 0 },
      { lengthComputable: true, loaded: 512, total: 1024 },
    ];
    const held = await uploadPhoto(photo, (percent) => percents.push(percent));
    expect(api.uploadsCreate).toHaveBeenCalledWith({
      purpose: 'PLACE_PHOTO',
      contentType: 'image/jpeg',
      bytes: 1024,
    });
    expect(FakeRequest.last).toMatchObject({
      method: 'PUT',
      url: 'https://storage.test/put',
      headers: signed.data.requiredHeaders,
      sent: photo,
    });
    expect(percents).toEqual([50]);
    expect(api.uploadsConfirm).toHaveBeenCalledWith('up1');
    expect(held).toEqual({
      key: 'up1',
      uploadId: 'up1',
      preview: 'https://media.test/thumb',
      altTextVi: '',
    });
  });

  it('shows a tour’s cover by its card', async () => {
    const held = await uploadPhoto(photo, undefined, 'TOUR_COVER');
    expect(held.preview).toBe('https://media.test/card');
  });

  it('says the upload isn’t ready when storage refuses or can’t be reached', async () => {
    FakeRequest.outcome = { status: 403 };
    await expect(uploadPhoto(photo)).rejects.toMatchObject({ code: 'UPLOAD_NOT_READY' });
    FakeRequest.outcome = 'error';
    await expect(uploadPhoto(photo)).rejects.toMatchObject({ code: 'UPLOAD_NOT_READY' });
    expect(api.uploadsConfirm).not.toHaveBeenCalled();
  });

  it('turns a refused confirmation into its code, and passes anything else on', async () => {
    api.uploadsConfirm.mockRejectedValueOnce(new ApiError(409, 'UPLOAD_NOT_FOUND', 'x'));
    const refused = await uploadPhoto(photo).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(UploadRefused);
    expect(refused).toMatchObject({ code: 'UPLOAD_NOT_FOUND', details: {} });
    api.uploadsConfirm.mockRejectedValueOnce(new Error('offline'));
    await expect(uploadPhoto(photo)).rejects.toThrow('offline');
  });
});
