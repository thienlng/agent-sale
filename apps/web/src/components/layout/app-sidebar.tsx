import { Link } from '@tanstack/react-router';
import {
  BarChart3,
  Bot,
  Cable,
  type LucideIcon,
  MessagesSquare,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@/components/logo';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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

import { NavUser } from './nav-user';

interface NavItem {
  to: string;
  key: string;
  icon: LucideIcon;
  ready?: boolean;
}

/** P0 items of docs/03 §2; the ones not built yet say so instead of pretending. */
const WORK: readonly NavItem[] = [
  { to: '/app/bots', key: 'nav.bots', icon: Bot, ready: true },
  { to: '/app/inbox', key: 'nav.inbox', icon: MessagesSquare },
  { to: '/app/channels', key: 'nav.channels', icon: Cable },
  { to: '/app/contacts', key: 'nav.contacts', icon: Users },
  { to: '/app/orders', key: 'nav.orders', icon: ShoppingBag },
  { to: '/app/analytics', key: 'nav.analytics', icon: BarChart3 },
  { to: '/app/settings', key: 'nav.settings', icon: Settings },
];

const PLATFORM: readonly NavItem[] = [
  { to: '/admin/llm', key: 'nav.adminLlm', icon: ShieldCheck, ready: true },
];

function NavGroup({ label, items }: { label: string; items: readonly NavItem[] }) {
  const { t } = useTranslation();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map(({ to, key, icon: Icon, ready }) => (
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
            ) : null}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** The dashboard sidebar; variant and collapse mode come from the user's preferences. */
export function AppSidebar() {
  const { t } = useTranslation();
  const session = useSession();
  const prefs = usePreferences();
  return (
    <Sidebar variant={prefs.sidebar_variant} collapsible={prefs.sidebar_collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={t('app.name')}>
              <Link to="/app/bots">
                <Logo className="group-data-[collapsible=icon]:hidden" />
                <Logo markOnly className="hidden group-data-[collapsible=icon]:inline-flex" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {/* `contents` keeps the sidebar's own layout while exposing a navigation landmark. */}
        <nav aria-label={t('nav.mainLabel')} className="contents">
          <NavGroup label={t('nav.groupWork')} items={WORK} />
          {session?.user.isPlatformAdmin ? (
            <NavGroup label={t('nav.admin')} items={PLATFORM} />
          ) : null}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
