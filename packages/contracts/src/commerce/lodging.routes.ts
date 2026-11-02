import { defineRoutes } from '../common/routes.js';
import {
  CreateStayRequest,
  StayListQuery,
  StayQuote,
  StayQuoteRequest,
  StayRequestDto,
  StayRequestList,
  UpdateStayStatusRequest,
} from './lodging.schema.js';

const scoped = { tag: 'commerce', auth: true, workspaceScoped: true } as const;
export const lodgingRoutes = defineRoutes([
  {
    ...scoped,
    method: 'get',
    path: '/stay-requests',
    assistant: { use: 'read', when: 'List lodging stay requests and their status.' },
    summary: 'Local lodging requests, not an external availability calendar',
    query: StayListQuery,
    responses: { 200: StayRequestList },
  },
  {
    ...scoped,
    method: 'post',
    path: '/stay-requests',
    assistant: { use: 'write', when: 'The owner asks to record a lodging request for a guest.' },
    summary: 'Create an idempotent unconfirmed lodging request',
    body: CreateStayRequest,
    responses: { 201: StayRequestDto },
  },
  {
    ...scoped,
    method: 'post',
    path: '/stay-requests/quote',
    assistant: { use: 'never' },
    summary: 'Reference rates and internal conflict check; never guarantees availability',
    body: StayQuoteRequest,
    responses: { 200: StayQuote },
  },
  {
    ...scoped,
    method: 'get',
    path: '/stay-requests/{id}',
    assistant: { use: 'read', when: 'One lodging stay request.' },
    summary: 'One lodging request',
    responses: { 200: StayRequestDto },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/stay-requests/{id}/status',
    assistant: {
      use: 'write',
      when: 'The owner asks to confirm or cancel a lodging stay request.',
    },
    summary: 'Review, explicitly confirm, or cancel a lodging request',
    body: UpdateStayStatusRequest,
    responses: { 200: StayRequestDto },
  },
]);
