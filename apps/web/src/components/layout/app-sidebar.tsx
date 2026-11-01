import { Link, useRouterState } from '@tanstack/react-router';
import {
  BarChart3,
  Blocks,
  Bot,
  Cable,
  ChevronRight,
  ClipboardList,
  type LucideIcon,
  MessagesSquare,
  Package,
  Settings,
  ShieldCheck,
  ShoppingBag,
  House,
  CalendarDays,
  Users,
  UsersRound,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@/components/logo';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { useCan } from '@/lib/permissions';
import { usePreferences } from '@/lib/preferences/preferences';
import { useSession } from '@/lib/session';

import { BusinessSelector, type CreateBusinessDialogProps } from './business-selector';

interface NavItem {
  to: string;
  key: string;
  icon: LucideIcon;
  ready?: boolean;
  /** Built and usable, but still being proven with real shops: says "Thử nghiệm". */
  beta?: boolean;
}

/** P0 items of docs/03 §2; the ones not built yet say so instead of pretending. */
const HOME: readonly NavItem[] = [
  { to: '/app/analytics', key: 'nav.analytics', icon: BarChart3, ready: true },
];
const BOTS: readonly NavItem[] = [{ to: '/app/bots', key: 'nav.bots', icon: Bot, ready: true }];
const WORK: readonly NavItem[] = [
  { to: '/app/members', key: 'nav.members', icon: UsersRound, ready: true },
  { to: '/app/settings', key: 'nav.settings', icon: Settings, ready: true },
];

/** The inbox: the page staff use most, one click from anywhere. */
const INBOX: readonly NavItem[] = [
  { to: '/app/inbox', key: 'nav.inbox', icon: MessagesSquare, ready: true },
];
/** The workspace's channel inventory (connected Pages and accounts), separate from the inbox. */
const INTEGRATIONS: readonly NavItem[] = [
  { to: '/app/channels', key: 'nav.channels', icon: Cable, ready: true },
];

/** The orders area (docs/03 §2 "Đơn hàng"): one entry with sub-pages. */
const ORDERS: readonly NavItem[] = [
  { to: '/app/orders/overview', key: 'nav.ordersOverview', icon: BarChart3 },
  { to: '/app/orders', key: 'nav.ordersList', icon: ShoppingBag },
  { to: '/app/orders/new', key: 'nav.ordersNew', icon: ShoppingBag },
  { to: '/app/order-settings', key: 'nav.orderSettings', icon: Settings },
];
const ORDER_PATHS = /^\/app\/(orders|order-settings)(\/|$)/;

/** The shared product catalog: its own top-level entry, used by orders and bots alike. */
const PRODUCTS: readonly NavItem[] = [
  { to: '/app/products', key: 'nav.products', icon: Package, ready: true },
];
/** Point-of-sale / inventory software (KiotViet, …) feeding the catalog. */
const PMS: readonly NavItem[] = [
  { to: '/app/integrations', key: 'nav.pms', icon: Blocks, ready: true, beta: true },
];
/** A hotel sells nights, not stock: calendar, bookings and properties replace orders and products. */
const LODGING: readonly NavItem[] = [
  { to: '/app/calendar', key: 'nav.calendar', icon: CalendarDays, ready: true },
  { to: '/app/bookings', key: 'nav.bookings', icon: ClipboardList, ready: true },
  { to: '/app/properties', key: 'nav.properties', icon: House, ready: true },
];

/** The customers area (docs/03 §2 "Khách hàng"). */
const CONTACTS: readonly NavItem[] = [
  { to: '/app/contacts', key: 'nav.contactsList', icon: Users },
  { to: '/app/crm-settings', key: 'nav.crmSettings', icon: Settings },
];
const CONTACT_PATHS = /^\/app\/(contacts|crm-settings)(\/|$)/;

/** A sidebar entry with sub-pages that opens while you are inside it. */
function SectionNav({
  label,
  icon: Icon,
  items,
  paths,
  exact,
}: {
  label: string;
  icon: LucideIcon;
  items: readonly NavItem[];
  paths: RegExp;
  /** Sub-pages that must not light up on their children. */
  exact?: string;
}) {
  const { t } = useTranslation();
  const { isMobile, setOpenMobile } = useSidebar();
  const inside = useRouterState({ select: (s) => paths.test(s.location.pathname) });
  return (
    <Collapsible asChild defaultOpen={inside} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={t(label)} isActive={inside}>
            <Icon />
            <span>{t(label)}</span>
            <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map(({ to, key }) => (
              <SidebarMenuSubItem key={to}>
                <SidebarMenuSubButton asChild>
                  <Link
                    to={to}
                    // The list must not light up on /app/orders/new or /overview.
                    activeOptions={{ exact: to === exact, includeSearch: false }}
                    activeProps={{ 'data-active': true }}
                    onClick={() => isMobile && setOpenMobile(false)}
                  >
                    <span>{t(key)}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

const PLATFORM: readonly NavItem[] = [
  { to: '/admin/llm', key: 'nav.adminLlm', icon: ShieldCheck, ready: true },
];

function NavGroup({
  label,
  items,
  children,
}: {
  label: string;
  items: readonly NavItem[];
  children?: ReactNode;
}) {
  return (
    <SidebarGroup>
      {/* Mono, uppercase and spaced: a quiet section marker that never competes with the items. */}
      <SidebarGroupLabel className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase">
        {label}
      </SidebarGroupLabel>
      <SidebarMenu>
        <NavItems items={items} />
        {children}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** A number waiting behind a nav entry (e.g. bot holds to review), keyed by the entry's path. */
export type NavCounts = Partial<Record<string, { count: number; label: string }>>;

function NavItems({
  items,
  counts,
}: {
  items: readonly NavItem[];
  counts?: NavCounts | undefined;
}) {
  const { t } = useTranslation();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <>
      {items.map(({ to, key, icon: Icon, ready, beta }) => {
        const waiting = counts?.[to];
        return (
          <SidebarMenuItem key={to}>
            <SidebarMenuButton asChild tooltip={t(key)}>
              <Link
                to={to}
                onClick={() => isMobile && setOpenMobile(false)}
                activeProps={{ 'data-active': true }}
              >
                <Icon />
                <span>{t(key)}</span>
              </Link>
            </SidebarMenuButton>
            {!ready ? (
              <SidebarMenuBadge className="font-normal text-muted-foreground">
                {t('nav.comingSoon')}
              </SidebarMenuBadge>
            ) : beta ? (
              <SidebarMenuBadge className="font-normal text-muted-foreground">
                {t('nav.beta')}
              </SidebarMenuBadge>
            ) : waiting && waiting.count > 0 ? (
              <SidebarMenuBadge className="bg-warning-soft text-warning">
                <span aria-hidden>{waiting.count}</span>
                <span className="sr-only">{waiting.label}</span>
              </SidebarMenuBadge>
            ) : null}
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

/** The dashboard sidebar; variant and collapse mode come from the user's preferences. */
export function AppSidebar({
  createBusinessDialog,
  industry,
  navCounts,
}: {
  createBusinessDialog?: ((props: CreateBusinessDialogProps) => ReactNode) | undefined;
  /** The business's industry; undefined while it loads (industry entries show placeholders). */
  industry?: string | undefined;
  /** Waiting counts composed by the route from features (shared code may not import them). */
  navCounts?: NavCounts | undefined;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const prefs = usePreferences();
  const canSettings = useCan('settings.manage');
  const canCatalog = useCan('catalog.manage');
  const pms = canCatalog ? <NavItems items={PMS} /> : null;
  return (
    <Sidebar variant={prefs.sidebar_variant} collapsible={prefs.sidebar_collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={t('app.name')}>
              <Link to="/app/overview">
                <Logo className="group-data-[collapsible=icon]:hidden" />
                <Logo markOnly className="hidden group-data-[collapsible=icon]:inline-flex" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <BusinessSelector createBusinessDialog={createBusinessDialog} />
      </SidebarHeader>
      <SidebarContent>
        {/* `contents` keeps the sidebar's own layout while exposing a navigation landmark. */}
        <nav aria-label={t('nav.mainLabel')} className="contents">
          <NavGroup label={t('nav.groupWork')} items={HOME}>
            <NavItems items={BOTS} />
            <NavItems items={INBOX} />
            <NavItems items={INTEGRATIONS} />
            {industry === 'hotel' ? pms : null}
            <SectionNav
              label="nav.contacts"
              icon={Users}
              items={CONTACTS.filter((i) => canSettings || i.to !== '/app/crm-settings')}
              paths={CONTACT_PATHS}
            />
            {industry === undefined ? (
              // Until the business loads its industry is unknown: hold the place instead of
              // flashing retail entries a hotel never has.
              <>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton showIcon data-testid="industry-nav-loading" />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              </>
            ) : industry === 'hotel' ? (
              <NavItems items={LODGING} counts={navCounts} />
            ) : (
              <>
                <SectionNav
                  label="nav.orders"
                  icon={ShoppingBag}
                  items={ORDERS.filter((i) => canSettings || i.to !== '/app/order-settings')}
                  paths={ORDER_PATHS}
                  exact="/app/orders"
                />
                <NavItems items={PRODUCTS} />
                {pms}
              </>
            )}
            <NavItems items={WORK} />
          </NavGroup>
          {session?.user.isPlatformAdmin ? (
            <NavGroup label={t('nav.admin')} items={PLATFORM} />
          ) : null}
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
