import { LODGING_VIDEO_MAX_BYTES, type UploadLodgingVideoResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart';

import { ApiError } from '../../../../common/http/api-error.js';
import {
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { LodgingMediaService } from '../../application/lodging-media.service.js';

const invalid = () =>
  new ApiError('VALIDATION_FAILED', 'Send one MP4 file in the multipart field "file"', {
    reason: 'INVALID_VIDEO',
  });

/** The bytes of the single `file` part; at most 25 MiB (413 VIDEO_TOO_LARGE above it). */
async function readVideoPart(req: FastifyRequest): Promise<Uint8Array> {
  if (!req.isMultipart()) throw invalid();
  try {
    const file = await req.file({ limits: { fileSize: LODGING_VIDEO_MAX_BYTES, files: 1 } });
    if (!file) throw invalid();
    const bytes = await file.toBuffer();
    if (file.mimetype !== 'video/mp4') throw invalid();
    return bytes;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE')
      throw new ApiError(
        'VALIDATION_FAILED',
        'The video is larger than 25 MB',
        { reason: 'VIDEO_TOO_LARGE' },
        413,
      );
    throw invalid();
  }
}

/** `POST /lodging/media/videos` (lodgingV2Routes): gallery video upload, multipart. */
@WorkspaceScoped()
@Controller('lodging/media')
export class LodgingMediaController {
  constructor(@Inject(LodgingMediaService) private readonly media: LodgingMediaService) {}

  @Post('videos')
  @HttpCode(201)
  @RequireCapability('catalog.manage')
  uploadVideo(
    @CurrentWorkspace() ws: WorkspaceId,
    @Req() req: FastifyRequest,
  ): Promise<UploadLodgingVideoResponse> {
    return this.media.uploadVideo(ws, () => readVideoPart(req));
  }
}
