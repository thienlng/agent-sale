import { useIsMutating } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Building2, Check, ChevronsUpDown, Loader2, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BusinessAvatar } from '@/components/business-avatar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { useSession } from '@/lib/session';

/** The single business picker. Account controls remain account-scoped. */
export function BusinessSelector() {
  const { t } = useTranslation();
  const session = useSession();
  const { isMobile, setOpenMobile } = useSidebar();
  const mutations = useIsMutating();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { busy, choose } = useBusinessSwitch();
  const current = session?.memberships.find((m) => m.workspaceId === session.workspaceId);
  async function select(id: string) {
    if (await choose(id)) {
      setOpen(false);
      if (isMobile) setOpenMobile(false);
    }
  }

  if (!session) return null;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (!busy) {
              setOpen(next);
              setSearch('');
            }
          }}
        >
          <PopoverTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={t('business.choose')}
              aria-label={t('business.choose')}
            >
              {current ? (
                <BusinessAvatar
                  workspaceId={current.workspaceId}
                  logoVersion={current.logoVersion}
                  icon={current.icon}
                  className="size-8"
                />
              ) : (
                <Building2 aria-hidden />
              )}
              <span className="grid min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
                <span className="text-xs text-muted-foreground">{t('business.current')}</span>
                <span className="truncate font-medium" title={current?.workspaceName}>
                  {current?.workspaceName ?? t('business.none')}
                </span>
              </span>
              <ChevronsUpDown
                aria-hidden
                className="ml-auto size-4 group-data-[collapsible=icon]:hidden"
              />
            </SidebarMenuButton>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            className="w-80 max-w-[calc(100vw-2rem)]"
            aria-label={t('business.choose')}
          >
            <label className="sr-only" htmlFor="business-search">
              {t('business.search')}
            </label>
            <Input
              id="business-search"
              placeholder={t('business.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={busy}
            />
            <div className="max-h-72 overflow-y-auto">
              {session.memberships
                .filter((m) =>
                  m.workspaceName.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()),
                )
                .map((m) => (
                  <button
                    key={m.workspaceId}
                    type="button"
                    disabled={busy || mutations > 0}
                    onClick={() => void select(m.workspaceId)}
                    aria-current={m.workspaceId === session.workspaceId ? 'true' : undefined}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                  >
                    <BusinessAvatar
                      workspaceId={m.workspaceId}
                      logoVersion={m.logoVersion}
                      icon={m.icon}
                    />
                    <span className="min-w-0 flex-1 break-words">{m.workspaceName}</span>
                    {m.workspaceId === session.workspaceId ? (
                      <Check aria-hidden className="size-4 shrink-0" />
                    ) : null}
                  </button>
                ))}
              {!session.memberships.some((m) =>
                m.workspaceName.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()),
              ) ? (
                <p className="p-2 text-sm text-muted-foreground">{t('business.noResults')}</p>
              ) : null}
            </div>
            <Link
              to="/app/overview"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Settings2 aria-hidden className="size-4" />
              {t('business.manageAccount')}
            </Link>
            <Link
              to="/app/businesses/new"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden className="size-4" />
              {t('nav.newBusiness')}
            </Link>
            {busy ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                {t('business.switching')}
              </p>
            ) : null}
            {mutations > 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('business.waitForSave')}
              </p>
            ) : null}
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
