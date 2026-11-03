/**
 * The dashboard pages the assistant may open with `ui_navigate`, per industry (QA Villas #1,
 * TinyMind B11). The source of truth is `apps/web/src/routes/app/**` and the sidebar's industry
 * rules (`apps/web/src/components/layout/app-sidebar.tsx`): a hotel sells nights (calendar,
 * bookings, properties replace orders and products), a SaaS business sells plans (no orders,
 * products or POS integrations), every other industry is a shop. Pure.
 */

/** Which businesses see a page. */
export type PageAudience = 'all' | 'shop' | 'hotel' | 'saas' | 'not_saas';

export interface DashboardPage {
  /** Under `/app`, with `{param}` placeholders. */
  path: string;
  /** What it is for, in English (the prompt's language). */
  purpose: string;
  audience: PageAudience;
}

/** Every page a business can use under `/app` (redirect-only addresses are left out). */
export const DASHBOARD_PAGES: readonly DashboardPage[] = [
  { path: '/app/overview', purpose: 'all businesses of the account at a glance', audience: 'all' },
  {
    path: '/app/businesses/new',
    purpose: 'create a new business (shop) in the account: name and industry',
    audience: 'all',
  },
  { path: '/app/analytics', purpose: 'statistics', audience: 'all' },
  {
    path: '/app/inbox',
    purpose: 'conversations with customers (bot and staff)',
    audience: 'all',
  },
  { path: '/app/channels', purpose: 'connected pages and channels', audience: 'all' },
  { path: '/app/contacts', purpose: 'customers (CRM)', audience: 'all' },
  {
    path: '/app/crm-settings',
    purpose:
      'customer settings: /sources, /statuses, /tags, /distribution (assigning customers to staff)',
    audience: 'all',
  },
  {
    path: '/app/crm-settings/saas-plans',
    purpose: 'the plans the business sells',
    audience: 'saas',
  },
  { path: '/app/orders/overview', purpose: 'order figures', audience: 'shop' },
  { path: '/app/orders', purpose: 'orders; /app/orders/{orderId} — one order', audience: 'shop' },
  { path: '/app/orders/new', purpose: 'create an order', audience: 'shop' },
  {
    path: '/app/order-settings',
    purpose: 'order settings: /statuses, /sources, /warehouses',
    audience: 'shop',
  },
  {
    path: '/app/products',
    purpose: 'product catalog; /app/products/{productId} — edit one product',
    audience: 'shop',
  },
  { path: '/app/products/new', purpose: 'add a product', audience: 'shop' },
  {
    path: '/app/calendar',
    purpose: 'room calendar: availability per villa/room and day, block dates',
    audience: 'hotel',
  },
  {
    path: '/app/bookings',
    purpose: 'bookings and bot holds waiting for review; the hold time setting',
    audience: 'hotel',
  },
  {
    path: '/app/properties',
    purpose:
      'villas, homestays and rooms; /app/properties/{propertyId} — one property: units, weekday rates, date-range prices, notes, photos',
    audience: 'hotel',
  },
  { path: '/app/bots', purpose: 'bots', audience: 'all' },
  {
    path: '/app/bots/{botId}',
    purpose:
      'one bot: setup steps and figures; /instructions — reply guidance and scenarios; /quick-replies — quick replies; /knowledge — business information and FAQ; /products — what the bot sells (villas and rooms for a hotel); /integrations — connect channels; /actions — API actions (/actions/new to add one); /history — training history; /settings — bot settings; /ads-tool — ads tool',
    audience: 'all',
  },
  {
    path: '/app/integrations',
    purpose: 'external sales/POS systems (KiotViet); /app/integrations/kiotviet — its setup',
    audience: 'not_saas',
  },
  { path: '/app/members', purpose: 'team members', audience: 'all' },
  {
    path: '/app/settings/profile',
    purpose: 'business settings (company name, profile)',
    audience: 'all',
  },
  { path: '/app/settings/security', purpose: 'account security', audience: 'all' },
  { path: '/app/settings/developers', purpose: 'API keys and webhooks', audience: 'all' },
  { path: '/app/settings/audit', purpose: 'activity log', audience: 'all' },
];

/** The audience group of an industry (`hotel`, `saas`, anything else is a shop). */
export function industryGroup(industry: string | undefined): 'shop' | 'hotel' | 'saas' {
  if (industry === 'hotel') return 'hotel';
  if (industry === 'saas') return 'saas';
  return 'shop';
}

/** The pages a business of `industry` has, in map order. */
export function pagesFor(industry: string | undefined): DashboardPage[] {
  const group = industryGroup(industry);
  return DASHBOARD_PAGES.filter(
    (p) =>
      p.audience === 'all' ||
      p.audience === group ||
      (p.audience === 'not_saas' && group !== 'saas'),
  );
}

/** `<path> — <purpose>` lines of the pages of `industry`. */
export function renderDashboardMap(industry: string | undefined): string {
  return pagesFor(industry)
    .map((p) => `${p.path} — ${p.purpose}`)
    .join('\n');
}
