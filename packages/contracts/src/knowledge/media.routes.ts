import { defineRoutes } from '../common/routes.js';
import { TrainingItemDto } from './knowledge.schema.js';
import { UploadBotImageRequest } from './media.schema.js';

export const mediaRoutes = defineRoutes([
  {
    method: 'post',
    path: '/bots/{botId}/media-upload',
    tag: 'knowledge',
    summary: 'Upload a verified bot image to configured S3-compatible storage',
    auth: true,
    workspaceScoped: true,
    body: UploadBotImageRequest,
    responses: { 201: TrainingItemDto },
  },
]);
