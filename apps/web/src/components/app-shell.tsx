import { useRouterState } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

import { AppSidebar } from './layout/app-sidebar';
import { LayoutControls, ThemeToggle } from './layout/layout-controls';

/** shadcn's sidebar remembers open/closed in this cookie (written by the component itself). */
function sidebarOpenByDefault(): boolean {
  return !document.cookie.split('; ').includes('sidebar_state=false');
}

/** Section name for the header, from the first meaningful path segment. */
const SECTION: Record<string, string> = {
  bots: 'nav.bots',
  inbox: 'nav.inbox',
  channels: 'nav.channels',
  contacts: 'nav.contacts',
  orders: 'nav.orders',
  analytics: 'nav.analytics',
  settings: 'nav.settings',
  llm: 'nav.adminLlm',
};

/**
 * Dashboard shell (Studio Admin layout on shadcn's Sidebar): the sidebar's
 * variant and collapse mode, the content width and the header behaviour all
 * follow the user's preferences (`data-*` attributes on <html>). The document
 * scrolls; the header can stay sticky. Pages that need the full area (the bot
 * space) set `data-content-padding="false"` on their root.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const segment = useRouterState({
    select: (s) => s.location.pathname.split('/').filter(Boolean)[1] ?? '',
  });
  const section = SECTION[segment];

  return (
    // Collapsed-sidebar items show their label as a tooltip; only the dashboard needs tooltips.
    <TooltipProvider delayDuration={0}>
      <SidebarProvider
        defaultOpen={sidebarOpenByDefault()}
        style={{ '--header-height': '3.25rem' } as CSSProperties}
      >
        <AppSidebar />
        <SidebarInset className="min-w-0 overflow-x-clip">
          <header
            className={[
              'flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4',
              // Sticky navbar: stays visible with a translucent, blurred background.
              '[html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-30',
              '[html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:bg-background/95 [html[data-navbar-style=sticky]_&]:backdrop-blur-md',
            ].join(' ')}
          >
            <SidebarTrigger className="-ml-1" aria-label={t('nav.toggleSidebar')} />
            <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
            {section ? <span className="truncate text-base font-medium">{t(section)}</span> : null}
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <LayoutControls />
            </div>
          </header>
          <div className="flex min-w-0 flex-1 flex-col p-4 md:p-6 has-data-[content-padding=false]:p-0 md:has-data-[content-padding=false]:p-0">
            <div className="flex w-full min-w-0 flex-1 flex-col [html[data-content-layout=centered]_&]:mx-auto [html[data-content-layout=centered]_&]:max-w-screen-xl has-data-[content-padding=false]:max-w-none!">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
