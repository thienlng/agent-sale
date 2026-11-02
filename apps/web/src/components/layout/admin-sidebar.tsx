import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ADMIN_NAV } from '@/components/layout/admin-nav';
import { Logo } from '@/components/logo';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { usePreferences } from '@/lib/preferences/preferences';

/**
 * Sidebar of the platform back-office (`/admin/*`, ADR-021 §6): only platform pages, never a
 * business's menus, so running the platform and running a business (e.g. Rapiz HQ) stay apart.
 * The footer leads back to the businesses.
 */
export function AdminSidebar() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const close = () => isMobile && setOpenMobile(false);
  return (
    <Sidebar variant={prefs.sidebar_variant} collapsible={prefs.sidebar_collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={t('nav.admin')}>
              <Link to="/admin/accounts" onClick={close}>
                <Logo className="group-data-[collapsible=icon]:hidden" />
                <Logo markOnly className="hidden group-data-[collapsible=icon]:inline-flex" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('nav.admin')} className="contents">
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
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('nav.backToBusinesses')}>
              <Link to="/app/overview" onClick={close}>
                <ArrowLeft />
                <span>{t('nav.backToBusinesses')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
