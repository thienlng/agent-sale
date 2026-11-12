import { defineRoutes } from '../common/routes.js';
import {
  ActionAssistantDraft,
  ActionDraftTestRequest,
  ActionDto,
  ActionInput,
  ActionListResponse,
  ActionTestRequest,
  ActionTestResult,
  UpdateActionRequest,
} from './index.js';

const base = { tag: 'action', auth: true, workspaceScoped: true } as const;

export const actionRoutes = defineRoutes([
  {
    ...base,
    method: 'get',
    path: '/bots/{botId}/actions',
    assistant: {
      use: 'read',
      when: 'Which external API actions a bot may call (secrets are never returned).',
    },
    summary: 'API actions the bot may call',
    responses: { 200: ActionListResponse },
  },
  {
    ...base,
    method: 'post',
    path: '/bots/{botId}/actions',
    assistant: {
      use: 'write',
      when: 'Draft a new API action for a bot from docs or a curl example the owner pasted; it is created disabled and without its secret.',
      body: ActionAssistantDraft,
    },
    summary: 'Create an API action',
    body: ActionInput,
    responses: { 201: ActionDto },
  },
  {
    ...base,
    method: 'post',
    path: '/bots/{botId}/actions/test',
    assistant: { use: 'never' },
    summary: 'Call the API once using the unsaved form (nothing is stored or recorded)',
    body: ActionDraftTestRequest,
    responses: { 200: ActionTestResult },
  },
  {
    ...base,
    method: 'get',
    path: '/bots/{botId}/actions/{actionId}',
    assistant: { use: 'read', when: 'Details of one bot API action (secrets are never returned).' },
    summary: 'One API action',
    responses: { 200: ActionDto },
  },
  {
    ...base,
    method: 'patch',
    path: '/bots/{botId}/actions/{actionId}',
    assistant: { use: 'never' },
    summary:
      'Update an API action (authSecret: absent keeps, empty clears; a new origin or auth needs a new one)',
    body: UpdateActionRequest,
    responses: { 200: ActionDto },
  },
  {
    ...base,
    method: 'delete',
    path: '/bots/{botId}/actions/{actionId}',
    assistant: { use: 'never' },
    summary: 'Delete an API action',
    responses: { 204: null },
  },
  {
    ...base,
    method: 'post',
    path: '/bots/{botId}/actions/{actionId}/test',
    assistant: { use: 'never' },
    summary: 'Call the API once with sample arguments',
    body: ActionTestRequest,
    responses: { 200: ActionTestResult },
  },
]);
