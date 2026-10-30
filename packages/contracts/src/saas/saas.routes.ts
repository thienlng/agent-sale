import { defineRoutes } from '../common/routes.js';
import {
  ContactSaasSubscription,
  PutSaasSubscription,
  SaasSubscriptionDto,
  SaasSubscriptionList,
  SaasSubscriptionListQuery,
  SaasSummary,
} from './saas.schema.js';

const scoped = { tag: 'saas', auth: true, workspaceScoped: true } as const;
export const saasRoutes = defineRoutes([
  {
    ...scoped,
    method: 'get',
    path: '/saas-subscriptions',
    summary:
      'Customer subscriptions by stage, customer ids or trials ending soon (needs contacts.view_all)',
    query: SaasSubscriptionListQuery,
    responses: { 200: SaasSubscriptionList },
  },
  {
    ...scoped,
    method: 'get',
    path: '/saas-subscriptions/summary',
    summary: 'MRR, customers per stage, trials ending soon',
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
