import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { MediaStorageUnavailableError } from '../../../common/storage/storage.errors.js';
import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { ProductImageService } from '../application/product-image.service.js';

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8, 1)]);
const ws = workspaceId(newId());

function fakeStorage(fail = false) {
  const puts: { key: string; mime: string; size: number }[] = [];
  const storage: PublicObjectStorage = {
    put: (key, bytes, mime) => {
      if (fail) return Promise.reject(new MediaStorageUnavailableError());
      puts.push({ key, mime, size: bytes.byteLength });
      return Promise.resolve(`https://cdn.test/${key}`);
    },
    remove: () => Promise.resolve(),
    isPublicUrlUnder: (url, prefix) => url.startsWith(`https://cdn.test/${prefix}`),
  };
  return { storage, puts };
}

describe('ProductImageService', () => {
  it('stores a verified image under products/<workspace>/ and returns its public URL', async () => {
    const { storage, puts } = fakeStorage();
    const { url } = await new ProductImageService(storage).upload(ws, {
      mimeType: 'image/png',
      base64: png.toString('base64'),
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toMatch(new RegExp(`^products/${ws}/[0-9a-f-]{36}\\.png$`));
    expect(puts[0]?.mime).toBe('image/png');
    expect(url).toBe(`https://cdn.test/${puts[0]?.key}`);
  });

  it('maps jpeg to a .jpg key', async () => {
    const { storage, puts } = fakeStorage();
    const jpeg = Buffer.from([255, 216, 255, 0, 1, 2, 255, 217]);
    await new ProductImageService(storage).upload(ws, {
      mimeType: 'image/jpeg',
      base64: jpeg.toString('base64'),
    });
    expect(puts[0]?.key.endsWith('.jpg')).toBe(true);
  });

  it('rejects bad magic bytes without touching storage', async () => {
    const { storage, puts } = fakeStorage();
    await expect(
      new ProductImageService(storage).upload(ws, {
        mimeType: 'image/png',
        base64: Buffer.from('hello world').toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'INVALID_IMAGE' } });
    expect(puts).toHaveLength(0);
  });

  it('rejects images over 1 MiB', async () => {
    const { storage } = fakeStorage();
    const big = Buffer.concat([png, Buffer.alloc(1_048_576)]);
    await expect(
      new ProductImageService(storage).upload(ws, {
        mimeType: 'image/png',
        base64: big.toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('answers UNAVAILABLE when storage is down', async () => {
    const { storage } = fakeStorage(true);
    await expect(
      new ProductImageService(storage).upload(ws, {
        mimeType: 'image/png',
        base64: png.toString('base64'),
      }),
    ).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      details: { reason: 'MEDIA_STORAGE_UNAVAILABLE' },
    });
  });
});
