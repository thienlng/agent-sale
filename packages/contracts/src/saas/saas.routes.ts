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
    assistant: {
      use: 'read',
      when: 'List customer subscriptions by stage, by customer or with trials ending soon.',
    },
    apiKey: true,
    summary:
      'Customer subscriptions by stage, customer ids or trials ending soon (needs contacts.view_all)',
    query: SaasSubscriptionListQuery,
    responses: { 200: SaasSubscriptionList },
  },
  {
    ...scoped,
    method: 'get',
    path: '/saas-subscriptions/summary',
    assistant: {
      use: 'read',
      when: 'MRR, customers per subscription stage and trials ending soon.',
    },
    summary: 'MRR, customers per stage, trials ending soon',
    responses: { 200: SaasSummary },
  },
  {
    ...scoped,
    method: 'get',
    path: '/contacts/{id}/saas-subscription',
    assistant: { use: 'read', when: "One customer's subscription." },
    apiKey: true,
    summary: "The customer's subscription, or null",
    responses: { 200: ContactSaasSubscription },
  },
  {
    ...scoped,
    method: 'put',
    path: '/contacts/{id}/saas-subscription',
    assistant: {
      use: 'write',
      when: "The owner asks to set or change a customer's plan, stage, period or price.",
    },
    apiKey: true,
    summary: "Create or replace the customer's subscription (optimistic version)",
    body: PutSaasSubscription,
    responses: { 200: SaasSubscriptionDto },
  },
  {
    ...scoped,
    method: 'get',
    path: '/contacts/{id}/saas-subscription/history',
    assistant: { use: 'read', when: "Plan, stage and MRR changes of a customer's subscription." },
    apiKey: true,
    summary: "Plan, stage and MRR changes of the customer's subscription, newest first",
    responses: { 200: SaasSubscriptionHistory },
  },
  {
    ...scoped,
    method: 'get',
    path: '/saas-plans',
    assistant: { use: 'read', when: 'The plan catalog the business sells, with period prices.' },
    apiKey: true,
    summary: "The business's plan catalog (archived plans included)",
    responses: { 200: SaasPlanList },
  },
  {
    ...scoped,
    method: 'post',
    path: '/saas-plans',
    assistant: { use: 'write', when: 'The owner asks to add a plan to the catalog.' },
    summary: 'Add a plan with its period prices (needs settings.manage)',
    body: CreateSaasPlan,
    responses: { 201: SaasPlanDto },
  },
  {
    ...scoped,
    method: 'patch',
    path: '/saas-plans/{planId}',
    assistant: {
      use: 'write',
      when: 'The owner asks to rename, reprice, reorder or archive a plan.',
    },
    summary: 'Rename, reprice, reorder or archive a plan (optimistic version)',
    body: UpdateSaasPlan,
    responses: { 200: SaasPlanDto },
  },
]);
