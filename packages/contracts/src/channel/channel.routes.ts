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
const scoped = { auth: true, workspaceScoped: true, tag: 'channel' } as const;
export const channelRoutes = defineRoutes([
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
    auth: false,
    tag: 'channel',
    method: 'get',
    path: '/channels/oauth/{provider}/callback',
    summary: 'Meta OAuth callback',
    responses: { 200: z.string() },
  },
]);
