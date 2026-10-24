import { defineRoutes } from '../common/routes.js';
import { EntitlementsDto } from './billing.schema.js';

export const billingRoutes = defineRoutes([
  {
    method: 'get',
    path: '/billing/entitlements',
    summary: 'What the current plan allows (limits and features)',
    tag: 'billing',
    auth: true,
    workspaceScoped: true,
    responses: { 200: EntitlementsDto },
  },
]);
