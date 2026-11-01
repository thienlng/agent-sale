import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { ExternalImageError } from '../api/index.js';
import { CatalogSyncService } from '../application/catalog-sync.service.js';
import type { CommerceStore } from '../application/ports/commerce-store.js';
import { downloadExternalImage } from '../infrastructure/image-import/download-image.js';

const WS = workspaceId('0192f0a0-0000-7000-8000-000000000001');

function storage() {
  const put = vi.fn(async (key: string) => `https://media.test/${key}`);
  return { put, remove: vi.fn(), isPublicUrlUnder: vi.fn() } as unknown as PublicObjectStorage & {
    put: typeof put;
  };
}

describe('importExternalImage', () => {
  it('stores the downloaded picture under the workspace product prefix', async () => {
    const images = storage();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const service = new CatalogSyncService({} as CommerceStore, images, async () => ({
      bytes,
      mime: 'image/png',
    }));
    const url = await service.importExternalImage(WS, 'https://cdn.kiotviet.vn/a.png');
    expect(url).toMatch(new RegExp(`^https://media\\.test/products/${WS}/[0-9a-f-]{36}\\.png$`));
    expect(images.put).toHaveBeenCalledWith(expect.any(String), bytes, 'image/png');
  });

  it('passes the downloader reason through and stores nothing', async () => {
    const images = storage();
    const service = new CatalogSyncService({} as CommerceStore, images, () =>
      Promise.reject(new ExternalImageError('unsupported_format')),
    );
    await expect(service.importExternalImage(WS, 'https://x.test/a.webp')).rejects.toMatchObject({
      reason: 'unsupported_format',
      details: { reason: 'unsupported_format' },
    });
    expect(images.put).not.toHaveBeenCalled();
  });

  it('maps a download failure to ExternalImageError with its short reason', async () => {
    const error = await downloadExternalImage('ftp://cdn.example.com/a.jpg').catch((e) => e);
    expect(error).toBeInstanceOf(ExternalImageError);
    expect(error.reason).toBe('unsupported_scheme');
  });
});
