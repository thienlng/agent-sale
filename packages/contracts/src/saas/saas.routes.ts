import { defineRoutes } from '../common/routes.js';
import {
  ContactSaasSubscription,
  CreateSaasRequest,
  PutSaasSubscription,
  SaasRequestDto,
  SaasRequestList,
  SaasRequestListQuery,
  SaasSubscriptionDto,
  SaasSubscriptionList,
  SaasSubscriptionListQuery,
  SaasSummary,
  UpdateSaasRequest,
} from './saas.schema.js';

const scoped = { tag: 'saas', auth: true, workspaceScoped: true } as const;
export const saasRoutes = defineRoutes([
  {
    ...scoped,
    method: 'get',
    path: '/saas-requests',
    summary: 'Demo, trial and consultation requests, newest first',
    query: SaasRequestListQuery,
    responses: { 200: SaasRequestList },
  },
  {
    ...scoped,
    method: 'post',
    path: '/saas-requests',
    summary: 'Record a request taken by staff (idempotent per clientRequestId)',
    body: CreateSaasRequest,
    responses: { 201: SaasRequestDto },
  },
  {
    ...scoped,
    method: 'get',
    path: '/saas-requests/{id}',
    summary: 'One request',
    responses: { 200: SaasRequestDto },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/saas-requests/{id}',
    summary: 'Follow up a request: status, details, linked customer, note',
    body: UpdateSaasRequest,
    responses: { 200: SaasRequestDto },
  },
  {
    ...scoped,
    method: 'get',
    path: '/saas-subscriptions',
    summary: 'Customer subscriptions (needs contacts.view_all)',
    query: SaasSubscriptionListQuery,
    responses: { 200: SaasSubscriptionList },
  },
  {
    ...scoped,
    method: 'get',
    path: '/saas-subscriptions/summary',
    summary: 'MRR, customers per stage, trials ending soon, new requests',
    responses: { 200: SaasSummary },
  },
  {
    ...scoped,
    method: 'get',
    path: '/contacts/{id}/saas-subscription',
    summary: "The customer's subscription, or null",
    responses: { 200: ContactSaasSubscription },
  },
  {
    ...scoped,
    method: 'put',
    path: '/contacts/{id}/saas-subscription',
    summary: "Create or replace the customer's subscription (optimistic version)",
    body: PutSaasSubscription,
    responses: { 200: SaasSubscriptionDto },
  },
]);
