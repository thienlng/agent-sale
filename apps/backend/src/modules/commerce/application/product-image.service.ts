import type { UploadProductImageRequest, UploadProductImageResponse } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { decodeImage } from '../../../common/storage/image-bytes.js';
import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { PRODUCT_IMAGE_STORAGE } from './ports/product-image-storage.js';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/** Product pictures are files on Rapiz storage, one prefix per workspace. */
@Injectable()
export class ProductImageService {
  constructor(@Inject(PRODUCT_IMAGE_STORAGE) private readonly storage: PublicObjectStorage) {}

  async upload(
    ws: WorkspaceId,
    input: UploadProductImageRequest,
  ): Promise<UploadProductImageResponse> {
    const bytes = decodeImage(input.base64, input.mimeType);
    const key = `products/${ws}/${newId()}.${EXTENSIONS[input.mimeType]}`;
    return { url: await this.storage.put(key, bytes, input.mimeType) };
  }
}
