import type { TrainingItemDto, UploadBotImageRequest } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { MediaFacade } from '../api/media.facade.js';
import { TRAINING_FACADE, type TrainingFacade } from '../api/training.facade.js';
import { decodeImage } from '../domain/image-upload.js';
import { BOT_MEDIA_STORAGE, type BotMediaStorage } from './ports/bot-media-storage.js';

@Injectable()
export class MediaFacadeImpl implements MediaFacade {
  constructor(
    @Inject(BOT_MEDIA_STORAGE) private readonly storage: BotMediaStorage,
    @Inject(TRAINING_FACADE) private readonly training: TrainingFacade,
  ) {}

  async upload(
    ws: WorkspaceId,
    botId: string,
    input: UploadBotImageRequest,
  ): Promise<TrainingItemDto> {
    const bytes = decodeImage(input.base64, input.mimeType);
    const extension = input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType.slice(6);
    const key = `workspaces/${ws}/bots/${botId}/${newId()}.${extension}`;
    const url = await this.storage.put(key, bytes, input.mimeType);
    try {
      return await this.training.create(ws, botId, {
        kind: 'media',
        title: input.title,
        content: '',
        trigger: '',
        notes: '',
        mediaUrl: url,
      });
    } catch (error) {
      // A failed metadata write must not leave a newly uploaded object behind.
      await this.storage.remove(key).catch(() => undefined);
      throw error;
    }
  }
}
