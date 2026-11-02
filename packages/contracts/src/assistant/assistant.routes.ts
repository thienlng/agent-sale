import { defineRoutes } from '../common/routes.js';
import {
  AssistantMessageList,
  AssistantRunDto,
  AssistantThreadDto,
  AssistantThreadList,
  AssistantThreadListQuery,
  CreateAssistantThreadRequest,
  SendAssistantMessageRequest,
  SendAssistantMessageResponse,
  UpdateAssistantThreadRequest,
} from './assistant.schema.js';

const scoped = { tag: 'assistant', auth: true, workspaceScoped: true } as const;
export const assistantRoutes = defineRoutes([
  {
    ...scoped,
    method: 'get',
    path: '/assistant/threads',
    summary: "The caller's assistant threads, newest first (search by q, archived filter)",
    query: AssistantThreadListQuery,
    responses: { 200: AssistantThreadList },
  },
  {
    ...scoped,
    method: 'post',
    path: '/assistant/threads',
    summary: 'Start an assistant thread',
    body: CreateAssistantThreadRequest,
    responses: { 201: AssistantThreadDto },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/assistant/threads/{threadId}',
    summary: 'Rename, pin or archive an assistant thread',
    body: UpdateAssistantThreadRequest,
    responses: { 200: AssistantThreadDto },
  },
  {
    ...scoped,
    method: 'get',
    path: '/assistant/threads/{threadId}/messages',
    summary: 'Visible messages of an assistant thread (no tool rows)',
    responses: { 200: AssistantMessageList },
  },
  {
    ...scoped,
    method: 'post',
    path: '/assistant/threads/{threadId}/messages',
    summary: 'Send a message and run the assistant (idempotent by turnId)',
    body: SendAssistantMessageRequest,
    responses: { 200: SendAssistantMessageResponse },
  },
  {
    ...scoped,
    method: 'get',
    path: '/assistant/runs/{runId}',
    summary: 'An assistant run with its steps',
    responses: { 200: AssistantRunDto },
  },
]);
