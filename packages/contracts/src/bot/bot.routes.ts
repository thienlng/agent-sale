import { z } from 'zod';

import { defineRoutes } from '../common/routes.js';
import {
  CreateFaqRequest,
  FaqDto,
  FaqListResponse,
  UpdateFaqRequest,
} from '../knowledge/knowledge.schema.js';
import { BotDto, BotReadiness, CreateBotRequest, UpdateBotRequest } from './bot.schema.js';

const BotList = z.object({ data: z.array(BotDto) });

export const botRoutes = defineRoutes([
  {
    method: 'get',
    path: '/bots',
    summary: 'Bots of the current workspace',
    tag: 'bot',
    auth: true,
    workspaceScoped: true,
    responses: { 200: BotList },
  },
  {
    method: 'post',
    path: '/bots',
    summary: 'Create a bot; seeds FAQs and settings from the industry pack',
    tag: 'bot',
    auth: true,
    workspaceScoped: true,
    body: CreateBotRequest,
    responses: { 201: BotDto },
  },
  {
    method: 'get',
    path: '/bots/{botId}',
    summary: 'One bot',
    tag: 'bot',
    auth: true,
    workspaceScoped: true,
    responses: { 200: BotDto },
  },
  {
    method: 'patch',
    path: '/bots/{botId}',
    summary: 'Update name, active flag or settings (partial)',
    tag: 'bot',
    auth: true,
    workspaceScoped: true,
    body: UpdateBotRequest,
    responses: { 200: BotDto },
  },
  {
    method: 'get',
    path: '/bots/{botId}/readiness',
    summary: 'Onboarding checklist and missing placeholders',
    tag: 'bot',
    auth: true,
    workspaceScoped: true,
    responses: { 200: BotReadiness },
  },
  {
    method: 'get',
    path: '/bots/{botId}/faqs',
    summary: 'FAQs of a bot',
    tag: 'knowledge',
    auth: true,
    workspaceScoped: true,
    responses: { 200: FaqListResponse },
  },
  {
    method: 'post',
    path: '/bots/{botId}/faqs',
    summary: 'Add a FAQ',
    tag: 'knowledge',
    auth: true,
    workspaceScoped: true,
    body: CreateFaqRequest,
    responses: { 201: FaqDto },
  },
  {
    method: 'patch',
    path: '/bots/{botId}/faqs/{faqId}',
    summary: 'Edit a FAQ',
    tag: 'knowledge',
    auth: true,
    workspaceScoped: true,
    body: UpdateFaqRequest,
    responses: { 200: FaqDto },
  },
  {
    method: 'delete',
    path: '/bots/{botId}/faqs/{faqId}',
    summary: 'Delete a FAQ',
    tag: 'knowledge',
    auth: true,
    workspaceScoped: true,
    responses: { 204: null },
  },
]);
