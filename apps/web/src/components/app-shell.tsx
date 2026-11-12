import { useRouterState } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

import { useSignedInFavicon } from '@/lib/favicon';
import { useSession } from '@/lib/session';

import { AccountMenu, type MenuDialogProps } from './layout/account-menu';
import { AccountSidebar, ACCOUNT_SIDEBAR_PATHS } from './layout/account-sidebar';
import { ADMIN_NAV } from './layout/admin-nav';
import { AppSidebar, type NavCounts } from './layout/app-sidebar';

/** shadcn's sidebar remembers open/closed in this cookie (written by the component itself). */
function sidebarOpenByDefault(): boolean {
  return !document.cookie.split('; ').includes('sidebar_state=false');
}

/** Section name for the header, from the first meaningful path segment. */
const SECTION: Record<string, string> = {
  assistant: 'nav.assistant',
  bots: 'nav.bots',
  inbox: 'nav.inbox',
  channels: 'nav.channels',
  contacts: 'nav.contacts',
  orders: 'nav.orders',
  products: 'nav.products',
  'order-settings': 'nav.orderSettings',
  analytics: 'nav.analytics',
  settings: 'nav.settings',
  calendar: 'nav.calendar',
  bookings: 'nav.bookings',
  properties: 'nav.properties',
  overview: 'nav.accountOverview',
  businesses: 'nav.groupBusinesses',
};

/** Every service business (education, spa) names its catalog "Dịch vụ", like the sidebar. */
const CATALOG_SECTION: Record<string, string> = { education: 'nav.services', spa: 'nav.services' };

/**
 * Dashboard shell (Studio Admin layout on shadcn's Sidebar): the sidebar's
 * variant and collapse mode, the content width and the header behaviour all
 * follow the user's preferences (`data-*` attributes on <html>). The document
 * scrolls; the header can stay sticky. Pages that need the full area (the bot
 * space) set `data-content-padding="false"` on their root.
 */
export function AppShell({
  children,
  planDialog,
  industry,
  navCounts,
  headerActions,
}: {
  children: ReactNode;
  /** Plan and billing popup for the account menu, composed by the route from `features/billing`. */
  planDialog?: ((props: MenuDialogProps) => ReactNode) | undefined;
  /** The current business's industry; hotels get lodging navigation, SaaS businesses their requests and subscribers. */
  industry?: string | undefined;
  /** Waiting counts next to sidebar entries, composed by the route (e.g. bot holds to review). */
  navCounts?: NavCounts | undefined;
  /** Header controls before the account menu (e.g. the notification bell), composed by the route. */
  headerActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const session = useSession();
  useSignedInFavicon();
  const segment = useRouterState({
    select: (s) => s.location.pathname.split('/').filter(Boolean)[1] ?? '',
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The platform back-office (ADR-021 §6) lives in the account layer: same sidebar, its own section names.
  const adminLayer = /^\/admin(\/|$)/.test(pathname);
  const section = adminLayer
    ? ADMIN_NAV.find((item) => pathname.startsWith(item.to))?.key
    : pathname === '/app/businesses/new'
      ? 'nav.newBusiness'
      : ((segment === 'products' ? CATALOG_SECTION[industry ?? ''] : undefined) ??
        SECTION[segment]);
  const accountLayer = ACCOUNT_SIDEBAR_PATHS.test(pathname);

  return (
    // Collapsed-sidebar items show their label as a tooltip; only the dashboard needs tooltips.
    <TooltipProvider delayDuration={0}>
      <SidebarProvider
        defaultOpen={sidebarOpenByDefault()}
        style={{ '--header-height': '3.5rem' } as CSSProperties}
      >
        {adminLayer || accountLayer ? (
          <AccountSidebar />
        ) : (
          <AppSidebar industry={industry} navCounts={navCounts} />
        )}
        <SidebarInset className="min-w-0 overflow-x-clip">
          <header
            className={[
              'flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4',
              // Sticky navbar: stays visible on a solid surface (brand effects: no blur by default).
              '[html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-30',
              '[html[data-navbar-style=sticky]_&]:rounded-t-[inherit]',
            ].join(' ')}
          >
            <SidebarTrigger className="-ml-1" aria-label={t('nav.toggleSidebar')} />
            <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
            {section ? (
              <span className="truncate font-display text-base font-semibold tracking-[-0.01em]">
                {t(section)}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {headerActions}
              <AccountMenu planDialog={planDialog} />
            </div>
          </header>
          <div className="flex min-w-0 flex-1 flex-col p-4 md:p-6 has-data-[content-padding=false]:p-0 md:has-data-[content-padding=false]:p-0">
            <div className="flex w-full min-w-0 flex-1 flex-col [html[data-content-layout=centered]_&]:mx-auto [html[data-content-layout=centered]_&]:max-w-screen-xl has-data-[content-padding=false]:max-w-none!">
              <div
                key={`${session?.user.id}:${session?.workspaceId}`}
                className="flex min-w-0 flex-1 flex-col"
              >
                {children}
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
