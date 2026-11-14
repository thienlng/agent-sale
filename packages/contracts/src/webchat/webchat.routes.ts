import { defineRoutes } from '../common/routes.js';
import {
  WebsiteVisitorDto,
  WidgetConfigDto,
  WidgetContactRequest,
  WidgetContactResponse,
  WidgetPhoneRequest,
  WidgetPhoneResponse,
  WidgetPollResponse,
  WidgetSendRequest,
  WidgetSendResponse,
  WidgetUploadResponse,
} from './webchat.schema.js';

/** Public widget routes: no bearer token, identified by site key + `Authorization: Visitor <token>`. */
const open = { auth: false, tag: 'webchat' } as const;

export const webchatRoutes = defineRoutes([
  {
    ...open,
    method: 'get',
    path: '/webchat/v1/sites/{key}',
    summary: 'Public widget settings of a site',
    responses: { 200: WidgetConfigDto },
  },
  {
    ...open,
    method: 'post',
    path: '/webchat/v1/sites/{key}/messages',
    summary: 'Send a visitor message (creates the visitor on the first call)',
    body: WidgetSendRequest,
    responses: { 202: WidgetSendResponse },
  },
  {
    ...open,
    method: 'get',
    path: '/webchat/v1/sites/{key}/messages',
    summary: 'Poll the visitor conversation (`after` = last seen message id)',
    responses: { 200: WidgetPollResponse },
  },
  {
    ...open,
    method: 'post',
    path: '/webchat/v1/sites/{key}/uploads',
    summary:
      'Upload one image (multipart field "file", at most 5 MB). Without a visitor token it starts the visitor and answers `visitorToken`; the optional query parameters firstUrl, referrer, pageUrl and pageTitle then fill the visitor row, and turnstileToken answers the challenge when the config named a Turnstile site key. The image is stored temporarily and deleted after a day unless a message references it',
    responses: { 200: WidgetUploadResponse },
  },
  {
    ...open,
    method: 'post',
    path: '/webchat/v1/sites/{key}/phone',
    summary: 'Leave a phone number',
    body: WidgetPhoneRequest,
    responses: { 200: WidgetPhoneResponse },
  },
  {
    ...open,
    method: 'post',
    path: '/webchat/v1/sites/{key}/contact',
    summary:
      'Leave contact details (lead form): a phone number or an email in `contact` and an optional name, which names a new customer or replaces a generated name',
    body: WidgetContactRequest,
    responses: { 200: WidgetContactResponse },
  },
  {
    auth: true,
    workspaceScoped: true,
    tag: 'webchat',
    method: 'get',
    path: '/webchat/conversations/{conversationId}/visitor',
    assistant: {
      use: 'read',
      when: 'Visitor details of a website chat conversation: pages visited, referrer, phone left.',
    },
    summary: 'Visitor details of a website conversation',
    responses: { 200: WebsiteVisitorDto },
  },
]);
