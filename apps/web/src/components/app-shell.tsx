import type { Locale } from '@agent-sales/i18n';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  BarChart3,
  Bot,
  Cable,
  Languages,
  LogOut,
  Menu,
  MessagesSquare,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { type ComponentType, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { setLocale } from '@/lib/i18n';
import { logout, useSession } from '@/lib/session';

import { Logo } from './logo';

interface NavItem {
  to: string;
  key: string;
  icon: ComponentType<{ className?: string }>;
  ready?: boolean;
}

/** P0 items of docs/03 §2; the ones not built yet say so instead of pretending. */
const NAV: readonly NavItem[] = [
  { to: '/app/bots', key: 'nav.bots', icon: Bot, ready: true },
  { to: '/app/inbox', key: 'nav.inbox', icon: MessagesSquare },
  { to: '/app/channels', key: 'nav.channels', icon: Cable },
  { to: '/app/contacts', key: 'nav.contacts', icon: Users },
  { to: '/app/orders', key: 'nav.orders', icon: ShoppingBag },
  { to: '/app/analytics', key: 'nav.analytics', icon: BarChart3 },
  { to: '/app/settings', key: 'nav.settings', icon: Settings },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const items: NavItem[] = session?.user.isPlatformAdmin
    ? [...NAV, { to: '/admin/llm', key: 'nav.admin', icon: ShieldCheck, ready: true }]
    : [...NAV];
  return (
    <nav aria-label={t('nav.mainLabel')} className="flex flex-col gap-0.5">
      {items.map(({ to, key, icon: Icon, ready }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-base text-sidebar-foreground transition-colors hover:bg-secondary data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground"
        >
          <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-primary opacity-0 group-data-[status=active]:opacity-100" />
          <Icon className="size-[18px] shrink-0" />
          <span className="truncate">{t(key)}</span>
          {!ready ? (
            <span className="ml-auto text-xs text-muted-foreground">{t('nav.comingSoon')}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

function UserMenu() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const navigate = useNavigate();
  if (!session) return null;
  const { user } = session;
  const workspace = session.memberships.find((m) => m.workspaceId === session.workspaceId);
  const initials = user.name
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary-soft text-sm font-semibold text-accent-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {workspace?.workspaceName}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages />
            {t('nav.language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={i18n.language}
              onValueChange={(v) => setLocale(v as Locale)}
            >
              <DropdownMenuRadioItem value="vi">Tiếng Việt</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void logout().finally(() => navigate({ to: '/login' }));
          }}
        >
          <LogOut />
          {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Shared shell: sidebar (a sheet on small screens) + content. The shell is
 * exactly one screen tall and only <main> scrolls, so in-page scrolling
 * (chat auto-scroll, sticky bars) never moves the whole document.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar p-3 lg:flex">
        <Link to="/app/bots" className="mb-5 px-2 pt-1">
          <Logo />
        </Link>
        <NavList />
        <div className="mt-auto border-t pt-3">
          <UserMenu />
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-3">
          <SheetTitle className="mb-4 px-2 pt-1">
            <Logo />
          </SheetTitle>
          <NavList onNavigate={() => setMobileOpen(false)} />
          <div className="mt-auto border-t pt-3">
            <UserMenu />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label={t('nav.mainLabel')}
          >
            <Menu />
          </Button>
          <Logo />
        </div>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
