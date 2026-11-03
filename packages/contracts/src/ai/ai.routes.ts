import { defineRoutes } from '../common/routes.js';
import { PlaygroundRequest, PlaygroundResponse } from './ai.schema.js';
import { BotTurnDetail, BotTurnList, BotTurnListQuery } from './turn-trace.schema.js';

export const aiRoutes = defineRoutes([
  {
    method: 'post',
    path: '/bots/{botId}/playground',
    assistant: { use: 'never' },
    summary: 'Test the bot: one grounded reply to a test conversation (not sent to any channel)',
    tag: 'ai',
    auth: true,
    workspaceScoped: true,
    body: PlaygroundRequest,
    responses: { 200: PlaygroundResponse },
  },
  {
    method: 'get',
    path: '/bots/{botId}/turns',
    assistant: {
      use: 'read',
      when: "Find the shop bot's recent turns (one per customer message burst) by conversation, time or words, to explain why the bot answered as it did.",
    },
    summary: "The shop bot's recent turns with diagnosis signals (30-day traces)",
    tag: 'ai',
    auth: true,
    workspaceScoped: true,
    query: BotTurnListQuery,
    responses: { 200: BotTurnList },
  },
  {
    method: 'get',
    path: '/bots/{botId}/turns/{runId}',
    assistant: {
      use: 'read',
      when: 'The trace of one bot turn: FAQ and scenario hits, tools called and how they ended, model, prompt and signals of what went wrong.',
    },
    summary: 'The trace of one shop-bot turn',
    tag: 'ai',
    auth: true,
    workspaceScoped: true,
    responses: { 200: BotTurnDetail },
  },
]);
