import { defineRoutes } from '../common/routes.js';
import { PlaygroundRequest, PlaygroundResponse } from './ai.schema.js';

export const aiRoutes = defineRoutes([
  {
    method: 'post',
    path: '/bots/{botId}/playground',
    summary: 'Test the bot: one grounded reply to a test conversation (not sent to any channel)',
    tag: 'ai',
    auth: true,
    workspaceScoped: true,
    body: PlaygroundRequest,
    responses: { 200: PlaygroundResponse },
  },
]);
