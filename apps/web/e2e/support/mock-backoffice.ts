/** Platform admin fixtures (accounts, plans, payments, billing settings) with long content. */
const now = '2026-11-02T08:00:00.000Z';
const LONG =
  'Công ty TNHH Thương mại và Dịch vụ Thời trang Nguyễn Thị Thanh Hương Lan Anh Phương Thảo';
const uuid = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a${String(n).padStart(2, '0')}`;

export const ADMIN_ACCOUNT_ID = uuid(1);

const entitlements = {
  'members.max': 5,
  'channels.max': 3,
  'contacts.max': null,
  'storage.bytes': 1_000_000_000,
  'media.max': 500,
  'knowledge_items.max': 200,
  'ai.models.allowed': ['smart', 'pro'],
  'ai.included_messages': { amount: 2000, periodDays: 30 },
  'feature.website_widget': true,
  'feature.lazada': false,
  'feature.facebook_posts': true,
  'feature.public_api': false,
  'api.requests_per_minute': 0,
  'brain.evaluations.daily': 200,
  'care.messages.daily': 100,
};

const plan = (
  code: string,
  name: string,
  version: number,
  extra: Record<string, unknown> = {},
) => ({
  code,
  version,
  name,
  description: LONG,
  isPublic: true,
  archived: false,
  sortOrder: version,
  priceByPeriod: { '1': 499_000, '3': 469_000, '6': 449_000, '12': 399_000 },
  entitlements,
  subscriberCount: 12,
  createdAt: now,
  ...extra,
});

const planRef = { code: 'pro', version: 2, name: 'Pro doanh nghiệp' };
const owner = (n: number) => ({
  id: uuid(20 + n),
  name: `Nguyễn Thị Thanh Hương Lan Anh ${n}`,
  email: `chu.cua.hang.thoi.trang.${n}@congty-rat-dai.com.vn`,
  phone: '0912345678',
});

const subscription = {
  plan: planRef,
  status: 'trialing',
  effectivePlan: planRef,
  periodMonths: null,
  periodStart: '2026-10-20T00:00:00.000Z',
  periodEnd: '2026-11-03T00:00:00.000Z',
  version: 4,
};

const row = (n: number) => ({
  id: uuid(n),
  name: `${LONG} ${n}`,
  status: n === 2 ? 'suspended' : 'active',
  owner: owner(n),
  subscription: n === 3 ? null : subscription,
  businessCount: n,
  createdAt: now,
});

const payment = (n: number, status: string) => ({
  id: uuid(40 + n),
  accountId: ADMIN_ACCOUNT_ID,
  accountName: `${LONG} 1`,
  code: `RPZ${String(n).padStart(6, '0')}`,
  plan: planRef,
  periodMonths: 12,
  amountVnd: 4_788_000,
  status,
  qrUrl: null,
  bankReference: status === 'confirmed' ? 'FT26306123456789' : null,
  note: LONG,
  confirmedAt: status === 'confirmed' ? now : null,
  createdAt: now,
});

export function backofficeRoute(path: string): unknown {
  if (path === '/admin/plans')
    return {
      data: [
        plan('free', 'Miễn phí', 1, { priceByPeriod: {}, subscriberCount: 140 }),
        plan('pro', 'Pro doanh nghiệp', 2),
        plan('pro', 'Pro doanh nghiệp', 1, { subscriberCount: 3 }),
      ],
    };
  if (path === '/admin/billing-settings')
    return {
      trialEnabled: true,
      trialPlanCode: 'pro',
      trialDays: 14,
      afterTrialPlanCode: 'free',
      hqContactScope: 'owner',
      graceDays: 7,
      suspendDays: 30,
      bankBin: '970436',
      bankAccountNo: '0123456789',
      bankAccountName: 'CONG TY TNHH RAPIZ',
      version: 3,
      updatedAt: now,
    };
  if (path === '/admin/accounts') return { data: [1, 2, 3].map(row), page: { nextCursor: null } };
  if (path === `/admin/accounts/${ADMIN_ACCOUNT_ID}`)
    return {
      ...row(1),
      statusReason: '',
      businesses: [1, 2].map((n) => ({
        id: uuid(30 + n),
        name: `${LONG} chi nhánh ${n}`,
        industry: 'retail',
        memberCount: 4,
        createdAt: now,
      })),
      accountMembers: [{ ...owner(1), role: 'owner' }],
      overrides: [
        {
          key: 'members.max',
          value: 20,
          reason: LONG,
          expiresAt: '2026-12-31T16:59:59.000Z',
          createdAt: now,
        },
      ],
      usage: {
        used: 1250,
        limit: 2000,
        cycleStart: '2026-10-20T00:00:00.000Z',
        cycleEnd: '2026-11-19T00:00:00.000Z',
      },
      payments: [payment(1, 'pending'), payment(2, 'confirmed')],
      audit: [
        {
          id: uuid(60),
          actorName: 'Lê Thiện',
          action: 'subscription.trial_extended',
          targetType: 'account',
          targetId: ADMIN_ACCOUNT_ID,
          reason: LONG,
          data: {},
          createdAt: now,
        },
      ],
    };
  if (path === '/admin/payments')
    return { data: [payment(1, 'pending'), payment(3, 'pending')], page: { nextCursor: null } };
  return undefined;
}
