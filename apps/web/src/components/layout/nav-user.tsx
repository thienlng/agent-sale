import type { Locale } from '@agent-sales/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Building2, Check, ChevronsUpDown, Languages, LogOut, Plus } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { groupByAccount } from '@/lib/business-groups';
import { setLocale } from '@/lib/i18n';
import { logout, useSession } from '@/lib/session';

/**
 * Account menu in the sidebar footer: who is signed in, switching or creating a business
 * (grouped by the account that owns it), language, log out.
 */
export function NavUser() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();
  const { busy, choose } = useBusinessSwitch();
  if (!session) return null;
  const { user } = session;
  const initials = user.name
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary-soft text-sm font-semibold text-accent-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {t('business.account')}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'top' : 'right'}
            align="end"
            sideOffset={4}
            className="w-60"
          >
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Building2 />
                {t('business.switch')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-96 w-64 overflow-y-auto">
                {groupByAccount(session.memberships).map((group, i) => (
                  <Fragment key={group.accountId ?? 'none'}>
                    {i > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                        {group.accountName ?? t('business.noAccount')}
                      </DropdownMenuLabel>
                      {group.businesses.map((m) => (
                        <DropdownMenuItem
                          key={m.workspaceId}
                          disabled={busy}
                          aria-current={m.workspaceId === session.workspaceId ? 'true' : undefined}
                          onSelect={() => {
                            void choose(m.workspaceId).then((done) => {
                              if (done && isMobile) setOpenMobile(false);
                            });
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{m.workspaceName}</span>
                          {m.workspaceId === session.workspaceId ? <Check aria-hidden /> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </Fragment>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void navigate({ to: '/businesses/new' })}>
                  <Plus />
                  {t('business.create')}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
                // Drop cached data so the next user in this tab never sees it.
                void logout().finally(() => {
                  queryClient.clear();
                  void navigate({ to: '/login' });
                });
              }}
            >
              <LogOut />
              {t('nav.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
