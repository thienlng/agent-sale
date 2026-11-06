import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { LodgingError } from '../domain/lodging.errors.js';
import type { LodgingAccess } from './lodging-access.js';
import { LodgingMediaService } from './lodging-media.service.js';

const ws = workspaceId('01890000-0000-7000-8000-000000000001');
const mp4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0]);

function setup(hotel = true) {
  const put = vi.fn(
    async (key: string, _bytes: Uint8Array, _mime: string) => `https://rapiz.test/media/${key}`,
  );
  const storage = { put, remove: vi.fn(), isPublicUrlUnder: () => false } as PublicObjectStorage;
  const access = {
    assertHotel: async () => {
      if (!hotel) throw new LodgingError('NOT_FOUND', 'Lodging workspace not found');
    },
  } as unknown as LodgingAccess;
  return { put, service: new LodgingMediaService(storage, access) };
}

describe('LodgingMediaService.uploadVideo', () => {
  it('stores an MP4 under lodging/<ws>/<uuid>.mp4 and answers its /media path and size', async () => {
    const { put, service } = setup();
    const res = await service.uploadVideo(ws, async () => mp4);
    const [key, bytes, mime] = put.mock.calls[0]!;
    expect(key).toMatch(new RegExp(`^lodging/${ws}/[0-9a-f-]{36}\\.mp4$`));
    expect(bytes).toBe(mp4);
    expect(mime).toBe('video/mp4');
    expect(res).toEqual({ url: `/media/${key}`, bytes: mp4.byteLength });
  });
  it('refuses bytes that are not an MP4 without storing them', async () => {
    const { put, service } = setup();
    await expect(service.uploadVideo(ws, async () => Buffer.from('GIF89a…'))).rejects.toMatchObject(
      {
        code: 'VALIDATION_FAILED',
        details: { reason: 'INVALID_VIDEO' },
      },
    );
    expect(put).not.toHaveBeenCalled();
  });
  it('checks the business before reading the upload', async () => {
    const { put, service } = setup(false);
    const read = vi.fn(async () => mp4);
    await expect(service.uploadVideo(ws, read)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(read).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
