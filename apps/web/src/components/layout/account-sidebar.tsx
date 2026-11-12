import { Link, useRouterState } from '@tanstack/react-router';
import { BrainCircuit, LayoutDashboard, Plus, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ADMIN_NAV } from '@/components/layout/admin-nav';
import { Logo } from '@/components/logo';
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
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { usePreferences } from '@/lib/preferences/preferences';
import { useSession } from '@/lib/session';
import { useIsAccountOwner } from '@/lib/use-is-account-owner';

/** Paths that belong to the account layer, above any single business. */
export { ACCOUNT_PATHS, ACCOUNT_SIDEBAR_PATHS } from '@/lib/account-paths';

/**
 * Sidebar of the account layer, above any single business: the overview, the gallery of all the
 * user's businesses (where one is opened), creating a business and, for platform admins, the
 * back-office pages, which open inside this same layer. It has no business-scoped entries (bots, inbox, customers…); opening a
 * business enters its own management area with the business sidebar.
 */
export function AccountSidebar() {
  const { t } = useTranslation();
  const session = useSession();
  const prefs = usePreferences();
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const close = () => isMobile && setOpenMobile(false);
  const count = session?.memberships.length ?? 0;
  // The owner assistant works for the whole account (ADR-024): it lives here, owners only.
  const isOwner = useIsAccountOwner();
  return (
    <Sidebar variant={prefs.sidebar_variant} collapsible={prefs.sidebar_collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={t('app.name')}>
              <Link to="/app/overview" onClick={close}>
                <Logo className="group-data-[collapsible=icon]:hidden [&_svg]:h-5! [&_svg]:w-auto!" />
                <Logo
                  markOnly
                  className="hidden group-data-[collapsible=icon]:inline-flex [&_svg]:h-4! [&_svg]:w-auto!"
                />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('nav.accountLabel')} className="contents">
          <SidebarGroup>
            <SidebarGroupLabel>{t('nav.groupAccount')}</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={t('nav.accountOverview')}
                  isActive={pathname === '/app/overview'}
                >
                  <Link to="/app/overview" onClick={close}>
                    <LayoutDashboard />
                    <span>{t('nav.accountOverview')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {isOwner ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={t('nav.assistant')}
                    isActive={pathname === '/app/assistant'}
                  >
                    <Link to="/app/assistant" onClick={close}>
                      <BrainCircuit />
                      <span>{t('nav.assistant')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={t('nav.groupBusinesses')}
                  isActive={/^\/app\/businesses\/?$/.test(pathname)}
                >
                  <Link to="/app/businesses" onClick={close}>
                    <Store />
                    <span>{t('nav.groupBusinesses')}</span>
                  </Link>
                </SidebarMenuButton>
                {count ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={t('nav.newBusiness')}
                  isActive={pathname === '/app/businesses/new'}
                >
                  <Link to="/app/businesses/new" onClick={close}>
                    <Plus />
                    <span>{t('nav.newBusiness')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {session?.user.isPlatformAdmin ? (
            <SidebarGroup>
              <SidebarGroupLabel>{t('nav.admin')}</SidebarGroupLabel>
              <SidebarMenu>
                {ADMIN_NAV.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      tooltip={t(item.key)}
                      isActive={pathname.startsWith(item.to)}
                    >
                      <Link to={item.to} onClick={close}>
                        <item.icon />
                        <span>{t(item.key)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
