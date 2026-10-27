import { defineRoutes } from '../common/routes.js';
import {
  WebsiteVisitorDto,
  WidgetConfigDto,
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
      'Upload one image (multipart field "file", at most 5 MB). Without a visitor token it starts the visitor and answers `visitorToken`; the optional query parameters firstUrl, referrer, pageUrl and pageTitle then fill the visitor row',
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
    auth: true,
    workspaceScoped: true,
    tag: 'webchat',
    method: 'get',
    path: '/webchat/conversations/{conversationId}/visitor',
    summary: 'Visitor details of a website conversation',
    responses: { 200: WebsiteVisitorDto },
  },
]);
