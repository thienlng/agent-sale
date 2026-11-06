import type { UploadLodgingVideoResponse } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { toMediaPath } from '../../../common/storage/media-url.js';
import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { isMp4 } from '../domain/mp4.js';
import { LodgingError } from '../domain/lodging.errors.js';
import { LodgingAccess } from './lodging-access.js';
import { LODGING_MEDIA_STORAGE } from './ports/lodging-media-storage.js';

/**
 * Videos of lodging galleries (T-192): MP4 files on Rapiz storage under `lodging/<ws>/`, answered
 * as their host-relative `/media/…` path. Deleting a gallery item never deletes the object.
 */
@Injectable()
export class LodgingMediaService {
  constructor(
    @Inject(LODGING_MEDIA_STORAGE) private readonly storage: PublicObjectStorage,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  /** `read` returns the uploaded bytes; it runs only after the business check. */
  async uploadVideo(
    ws: WorkspaceId,
    read: () => Promise<Uint8Array>,
  ): Promise<UploadLodgingVideoResponse> {
    await this.access.assertHotel(ws);
    const bytes = await read();
    if (!isMp4(bytes))
      throw new LodgingError('VALIDATION_FAILED', 'Upload an MP4 video', {
        reason: 'INVALID_VIDEO',
      });
    const key = `lodging/${ws}/${newId()}.mp4`;
    const url = toMediaPath(await this.storage.put(key, bytes, 'video/mp4'));
    return { url, bytes: bytes.byteLength };
  }
}
