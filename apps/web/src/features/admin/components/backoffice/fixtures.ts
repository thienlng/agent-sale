import { completeEntitlements } from '../../lib/entitlements';

export const ACCOUNT_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b01';
const OWNER_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b02';

export const plan = (over: Record<string, unknown> = {}) => ({
  code: 'pro',
  version: 2,
  name: 'Pro',
  description: '',
  isPublic: true,
  archived: false,
  sortOrder: 1,
  priceByPeriod: { '1': 499000, '12': 399000 },
  entitlements: completeEntitlements({ 'members.max': 5 }),
  subscriberCount: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

export const account = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT_ID,
  name: 'Shop Lan',
  status: 'active',
  statusReason: '',
  owner: { id: OWNER_ID, name: 'Lan', email: 'lan@example.vn', phone: null },
  subscription: {
    plan: { code: 'pro', version: 2, name: 'Pro' },
    status: 'trialing',
    effectivePlan: { code: 'pro', version: 2, name: 'Pro' },
    periodMonths: null,
    periodStart: '2026-10-20T00:00:00.000Z',
    periodEnd: '2026-11-03T00:00:00.000Z',
    version: 4,
  },
  businessCount: 1,
  createdAt: '2026-10-20T00:00:00.000Z',
  businesses: [
    {
      id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b03',
      name: 'Shop Lan Q1',
      industry: 'retail',
      memberCount: 2,
      createdAt: '2026-10-20T00:00:00.000Z',
    },
  ],
  accountMembers: [],
  overrides: [],
  usage: {
    used: 120,
    limit: 1000,
    cycleStart: '2026-10-20T00:00:00.000Z',
    cycleEnd: '2026-11-19T00:00:00.000Z',
  },
  payments: [],
  audit: [],
  ...over,
});
