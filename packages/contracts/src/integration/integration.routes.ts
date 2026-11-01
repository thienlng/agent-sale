import { defineRoutes, type RouteContract } from '../common/routes.js';
import {
  ConnectionDto,
  ConnectKiotVietRequest,
  IntegrationListResponse,
  KiotVietCredentials,
  KiotVietTestResponse,
  SyncLogResponse,
  UpdateKiotVietRequest,
} from './integration.schema.js';

const scoped = { auth: true, workspaceScoped: true } as const;
const route = <T extends Omit<RouteContract, 'auth' | 'workspaceScoped'>>(r: T) => ({
  ...r,
  ...scoped,
});

// Error statuses (400/404/409) use the shared ErrorResponse, documented as each route's `default`.
export const integrationRoutes = defineRoutes([
  route({
    method: 'get',
    path: '/integrations',
    summary: 'PMS providers and the workspace connection to each',
    tag: 'integration',
    responses: { 200: IntegrationListResponse },
  }),
  route({
    method: 'post',
    path: '/integrations/kiotviet/test',
    summary:
      'Check KiotViet credentials, list branches and preview the first sync (400 if rejected)',
    tag: 'integration',
    body: KiotVietCredentials,
    responses: { 200: KiotVietTestResponse },
  }),
  route({
    method: 'post',
    path: '/integrations/kiotviet',
    summary: 'Connect KiotViet and start the first sync (409 if already connected)',
    tag: 'integration',
    body: ConnectKiotVietRequest,
    responses: { 201: ConnectionDto },
  }),
  route({
    method: 'patch',
    path: '/integrations/kiotviet',
    summary:
      'Change KiotViet settings or credentials (404 if not connected, 409 on a stale version)',
    tag: 'integration',
    body: UpdateKiotVietRequest,
    responses: { 200: ConnectionDto },
  }),
  route({
    method: 'post',
    path: '/integrations/kiotviet/sync',
    summary:
      'Queue a KiotViet sync (404 if not connected, 409 while one is running or when the connect step failed)',
    tag: 'integration',
    responses: { 202: null },
  }),
  route({
    method: 'get',
    path: '/integrations/kiotviet/log',
    summary: 'Recent KiotViet sync log entries (404 if never connected)',
    tag: 'integration',
    responses: { 200: SyncLogResponse },
  }),
  route({
    method: 'post',
    path: '/integrations/kiotviet/orders/{orderId}/push',
    summary:
      'Retry pushing an order to KiotViet after its push failed (404 unknown order, 409 if the push has not failed)',
    tag: 'integration',
    responses: { 202: null },
  }),
  route({
    method: 'delete',
    path: '/integrations/kiotviet',
    summary: 'Disconnect KiotViet; synced products stay as Rapiz products (404 if not connected)',
    tag: 'integration',
    responses: { 204: null },
  }),
]);
