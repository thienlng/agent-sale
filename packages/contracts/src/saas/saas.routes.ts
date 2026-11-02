import { defineRoutes } from '../common/routes.js';
import {
  ContactSaasSubscription,
  CreateSaasPlan,
  SaasPlanDto,
  SaasPlanList,
  SaasSubscriptionHistory,
  UpdateSaasPlan,
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
  {
    ...scoped,
    method: 'get',
    path: '/contacts/{id}/saas-subscription/history',
    summary: "Plan, stage and MRR changes of the customer's subscription, newest first",
    responses: { 200: SaasSubscriptionHistory },
  },
  {
    ...scoped,
    method: 'get',
    path: '/saas-plans',
    summary: "The business's plan catalog (archived plans included)",
    responses: { 200: SaasPlanList },
  },
  {
    ...scoped,
    method: 'post',
    path: '/saas-plans',
    summary: 'Add a plan with its period prices (needs settings.manage)',
    body: CreateSaasPlan,
    responses: { 201: SaasPlanDto },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/saas-plans/{planId}',
    summary: 'Rename, reprice, reorder or archive a plan (optimistic version)',
    body: UpdateSaasPlan,
    responses: { 200: SaasPlanDto },
  },
]);
