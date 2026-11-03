import { defineRoutes } from '../common/routes.js';
import { EntitlementsDto, MessageUsageDto } from './billing.schema.js';

export const billingRoutes = defineRoutes([
  {
    method: 'get',
    path: '/billing/entitlements',
    assistant: {
      use: 'read',
      when: 'What the current plan allows: limits and features, for example how many bots or channels.',
    },
    summary: 'What the current plan allows (limits and features)',
    tag: 'billing',
    auth: true,
    workspaceScoped: true,
    responses: { 200: EntitlementsDto },
  },
  {
    method: 'get',
    path: '/billing/usage',
    assistant: {
      use: 'read',
      when: 'How much of the AI reply allowance the account has used in the current cycle.',
    },
    summary: "The account's AI reply allowance and its use in the current cycle",
    tag: 'billing',
    auth: true,
    workspaceScoped: true,
    responses: { 200: MessageUsageDto },
  },
]);
