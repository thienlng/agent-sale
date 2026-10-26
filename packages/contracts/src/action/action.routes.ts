import { defineRoutes } from '../common/routes.js';
import {
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
    summary: 'API actions the bot may call',
    responses: { 200: ActionListResponse },
  },
  {
    ...base,
    method: 'post',
    path: '/bots/{botId}/actions',
    summary: 'Create an API action',
    body: ActionInput,
    responses: { 201: ActionDto },
  },
  {
    ...base,
    method: 'post',
    path: '/bots/{botId}/actions/test',
    summary: 'Call the API once using the unsaved form (nothing is stored or recorded)',
    body: ActionDraftTestRequest,
    responses: { 200: ActionTestResult },
  },
  {
    ...base,
    method: 'get',
    path: '/bots/{botId}/actions/{actionId}',
    summary: 'One API action',
    responses: { 200: ActionDto },
  },
  {
    ...base,
    method: 'patch',
    path: '/bots/{botId}/actions/{actionId}',
    summary: 'Update an API action (authSecret: absent keeps, empty clears)',
    body: UpdateActionRequest,
    responses: { 200: ActionDto },
  },
  {
    ...base,
    method: 'delete',
    path: '/bots/{botId}/actions/{actionId}',
    summary: 'Delete an API action',
    responses: { 204: null },
  },
  {
    ...base,
    method: 'post',
    path: '/bots/{botId}/actions/{actionId}/test',
    summary: 'Call the API once with sample arguments',
    body: ActionTestRequest,
    responses: { 200: ActionTestResult },
  },
]);
