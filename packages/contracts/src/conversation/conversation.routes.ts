import { defineRoutes } from '../common/routes.js';
import {
  ConversationListQuery,
  ConversationListResponse,
  ConversationDetailDto,
  InboxMessageDto,
  SendInboxMessageRequest,
  UpdateConversationRequest,
  ConversationDto,
} from './conversation.schema.js';
const scoped = { auth: true, workspaceScoped: true, tag: 'conversation' } as const;
export const conversationRoutes = defineRoutes([
  {
    ...scoped,
    method: 'get',
    path: '/conversations',
    summary: 'Workspace inbox',
    query: ConversationListQuery,
    responses: { 200: ConversationListResponse },
  },
  {
    ...scoped,
    method: 'get',
    path: '/conversations/{id}',
    summary: 'Conversation and recent messages',
    responses: { 200: ConversationDetailDto },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/conversations/{id}',
    summary: 'Take over, assign, resolve or annotate',
    body: UpdateConversationRequest,
    responses: { 200: ConversationDto },
  },
  {
    ...scoped,
    method: 'post',
    path: '/conversations/{id}/messages',
    summary: 'Send a reply and pause automation',
    body: SendInboxMessageRequest,
    responses: { 201: InboxMessageDto },
  },
]);
