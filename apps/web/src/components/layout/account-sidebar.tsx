import { Link, useRouterState } from '@tanstack/react-router';
import { LayoutDashboard, Plus, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BusinessAvatar } from '@/components/business-avatar';
import { Logo } from '@/components/logo';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { usePreferences } from '@/lib/preferences/preferences';
import { useSession } from '@/lib/session';

/** Paths that belong to the account layer, above any single business. */
export const ACCOUNT_PATHS = /^\/app\/(overview|businesses)(\/|$)/;

/**
 * Sidebar of the account layer: all businesses of the signed-in account. It has no
 * business-scoped entries (bots, inbox, customers…); choosing a business enters its
 * own management area with the business sidebar.
 */
export function AccountSidebar() {
  const { t } = useTranslation();
  const session = useSession();
  const prefs = usePreferences();
  const { isMobile, setOpenMobile } = useSidebar();
  const { busy, choose } = useBusinessSwitch();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const close = () => isMobile && setOpenMobile(false);
  return (
    <Sidebar variant={prefs.sidebar_variant} collapsible={prefs.sidebar_collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={t('app.name')}>
              <Link to="/app/overview" onClick={close}>
                <Logo className="group-data-[collapsible=icon]:hidden" />
                <Logo markOnly className="hidden group-data-[collapsible=icon]:inline-flex" />
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
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t('nav.groupBusinesses')}</SidebarGroupLabel>
            <SidebarMenu>
              {session?.memberships.map((m) => (
                <SidebarMenuItem key={m.workspaceId}>
                  <SidebarMenuButton
                    tooltip={m.workspaceName}
                    disabled={busy}
                    onClick={() => void choose(m.workspaceId).then((ok) => ok && close())}
                  >
                    <BusinessAvatar
                      workspaceId={m.workspaceId}
                      logoVersion={m.logoVersion}
                      icon={m.icon}
                    />
                    <span className="truncate">{m.workspaceName}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={t('nav.adminLlm')}>
                    <Link to="/admin/llm" onClick={close}>
                      <ShieldCheck />
                      <span>{t('nav.adminLlm')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          ) : null}
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
