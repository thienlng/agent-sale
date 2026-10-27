import {
  FanpageSettings,
  FanpagePost,
  FanpageComment,
  FanpageAction,
  FanpageManualAction,
} from './fanpage.schema.js';
import { z } from 'zod';
import { defineRoutes } from '../common/routes.js';
import {
  ChannelListResponse,
  ChannelConnectionDto,
  ConnectChannelResponse,
  DiscoveryDto,
  SelectChannelRequest,
  UpdateChannelRequest,
} from './channel.schema.js';
import { CreateWebsiteRequest, UpdateWebsiteRequest } from './website.schema.js';
const scoped = { auth: true, workspaceScoped: true, tag: 'channel' } as const;
export const channelRoutes = defineRoutes([
  {
    ...scoped,
    method: 'get',
    path: '/channels/{id}/fanpage/settings',
    summary: 'Facebook comment automation settings',
    responses: { 200: FanpageSettings },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/channels/{id}/fanpage/settings',
    summary: 'Configure Facebook comment automation',
    body: FanpageSettings,
    responses: { 200: FanpageSettings },
  },
  {
    ...scoped,
    method: 'get',
    path: '/channels/{id}/fanpage/posts',
    summary: 'Latest 50 Page-owned posts',
    responses: { 200: z.object({ data: z.array(FanpagePost) }) },
  },
  {
    ...scoped,
    method: 'get',
    path: '/channels/{id}/fanpage/comments',
    summary: 'Latest 100 received comments and action outcomes',
    responses: { 200: z.object({ data: z.array(FanpageComment) }) },
  },
  {
    ...scoped,
    method: 'post',
    path: '/channels/{id}/fanpage/comments/{commentId}/actions',
    summary: 'Staff reply or moderation override',
    body: FanpageManualAction,
    responses: { 201: z.object({ action: FanpageAction.nullable() }) },
  },
  {
    ...scoped,
    method: 'get',
    path: '/channels',
    summary: 'Connections and provider readiness',
    responses: { 200: ChannelListResponse },
  },
  {
    ...scoped,
    method: 'post',
    path: '/channels/{provider}/connect',
    summary: 'Start a server-bound Meta consent flow',
    responses: { 201: ConnectChannelResponse },
  },
  {
    ...scoped,
    method: 'get',
    path: '/channels/discoveries/{id}',
    summary: 'Accounts granted by Meta',
    responses: { 200: DiscoveryDto },
  },
  {
    ...scoped,
    method: 'post',
    path: '/channels/discoveries/{id}/select',
    summary: 'Save selected granted accounts',
    body: SelectChannelRequest,
    responses: { 201: z.object({ data: z.array(ChannelConnectionDto) }) },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/channels/{id}',
    summary: 'Bind a bot or disconnect',
    body: UpdateChannelRequest,
    responses: { 200: ChannelConnectionDto },
  },
  {
    ...scoped,
    method: 'post',
    path: '/channels/website',
    summary: 'Create a website chat connection',
    body: CreateWebsiteRequest,
    responses: { 201: ChannelConnectionDto },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/channels/{id}/website',
    summary: 'Update website widget settings, name or enabled state',
    body: UpdateWebsiteRequest,
    responses: { 200: ChannelConnectionDto },
  },
  {
    auth: false,
    tag: 'channel',
    method: 'get',
    path: '/channels/oauth/{provider}/callback',
    summary: 'Meta OAuth callback',
    responses: { 200: z.string() },
  },
]);
