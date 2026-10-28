import type { Locale } from '@agent-sales/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  LogOut,
  MonitorCog,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { siteUrl } from '@/lib/env';
import { setLocale } from '@/lib/i18n';
import { setPreference, usePreferences } from '@/lib/preferences/preferences';
import { PREFERENCES, type PreferenceValues } from '@/lib/preferences/registry';
import { logout, useSession } from '@/lib/session';

import { LayoutCustomizeDialog } from './layout-controls';

type View = 'main' | 'display';

/** Props of a popup the shell lets a route plug in (shared components may not import features). */
export interface MenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass to `DialogContent`: sends focus back to the avatar when the popup closes. */
  onCloseAutoFocus: (event: Event) => void;
}

/** Round grey icon well in front of each row, as in Facebook's account menu. */
function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted [&_svg]:size-4">
      {children}
    </span>
  );
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(-2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/**
 * The only personal control in the shell: an avatar at the top right that opens a compact
 * panel (who is signed in, plan and billing, account security, display and language, the
 * marketing site, log out). Display settings open in place, one level deeper, so the first
 * view stays short; plan details open in a popup supplied by the route (`planDialog`).
 */
export function AccountMenu({
  planDialog,
}: {
  planDialog?: ((props: MenuDialogProps) => ReactNode) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const themeMode = usePreferences().theme_mode;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('main');
  const [customizing, setCustomizing] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const firstItem = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Popups open from a menu row that unmounts with the menu; without this, focus lands on <body>.
  const returnFocus = (event: Event) => {
    event.preventDefault();
    trigger.current?.focus();
  };

  // The focused row unmounts when the view swaps; hand focus to the new view's first row.
  // On open, Radix already focuses the menu (or its first row when opened by keyboard).
  const swapped = useRef(false);
  useEffect(() => {
    if (swapped.current) firstItem.current?.focus();
    swapped.current = true;
  }, [view]);

  if (!session) return null;
  const { user } = session;
  const initials = initialsOf(user.name);
  const keepOpen = (e: Event) => e.preventDefault();

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setView('main');
        }}
      >
        <DropdownMenuTrigger
          ref={trigger}
          aria-label={t('account.open', { name: user.name })}
          // p-1 around the 36px avatar gives a 44px hit area.
          className="relative rounded-full p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary-soft text-sm font-semibold text-accent-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span
            aria-hidden
            className="absolute right-0.5 bottom-0.5 flex size-4 items-center justify-center rounded-full border-2 border-background bg-muted text-foreground"
          >
            <ChevronDown className="size-2.5" strokeWidth={3} />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          // Escape in the display view goes back one level first, like Facebook's menu.
          onEscapeKeyDown={(e) => {
            if (view === 'display') {
              e.preventDefault();
              setView('main');
            }
          }}
          className="w-80 max-w-[calc(100vw-1rem)] p-2"
        >
          {view === 'main' ? (
            <>
              <DropdownMenuLabel className="mb-1 flex items-center gap-3 rounded-lg border p-3 font-normal shadow-xs">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-primary-soft font-semibold text-accent-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="grid min-w-0">
                  <span className="truncate text-base font-semibold">{user.name}</span>
                  <span className="text-xs break-all text-muted-foreground">{user.email}</span>
                </span>
              </DropdownMenuLabel>
              {planDialog ? (
                <DropdownMenuItem
                  ref={firstItem}
                  className="gap-3 py-1.5"
                  onSelect={() => setPlanOpen(true)}
                >
                  <RowIcon>
                    <CreditCard />
                  </RowIcon>
                  {t('account.plan')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                ref={planDialog ? undefined : firstItem}
                asChild
                className="gap-3 py-1.5"
              >
                <Link to="/app/settings/security">
                  <RowIcon>
                    <ShieldCheck />
                  </RowIcon>
                  {t('account.security')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-3 py-1.5"
                onSelect={(e) => {
                  e.preventDefault();
                  setView('display');
                }}
              >
                <RowIcon>
                  <MonitorCog />
                </RowIcon>
                {t('account.display')}
                <ChevronRight className="ml-auto text-muted-foreground" />
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="gap-3 py-1.5">
                <a href={siteUrl()} target="_blank" rel="noopener">
                  <RowIcon>
                    <ExternalLink />
                  </RowIcon>
                  {t('account.home')}
                  <span className="sr-only"> ({t('account.newTab')})</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-3 py-1.5"
                onSelect={() => {
                  // Drop cached data so the next user in this tab never sees it.
                  void logout().finally(() => {
                    queryClient.clear();
                    void navigate({ to: '/login' });
                  });
                }}
              >
                <RowIcon>
                  <LogOut />
                </RowIcon>
                {t('nav.logout')}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem
                ref={firstItem}
                className="gap-3 py-1.5 text-base font-semibold"
                onSelect={(e) => {
                  e.preventDefault();
                  setView('main');
                }}
              >
                <RowIcon>
                  <ArrowLeft />
                </RowIcon>
                <span className="sr-only">{t('account.back')}: </span>
                {t('account.display')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {t('account.theme')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={themeMode}
                onValueChange={(v) =>
                  setPreference('theme_mode', v as PreferenceValues['theme_mode'])
                }
              >
                {PREFERENCES.theme_mode.values.map((v) => (
                  <DropdownMenuRadioItem key={v} value={v} onSelect={keepOpen}>
                    {t(`preferences.theme_mode.${v}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {t('nav.language')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={i18n.language}
                onValueChange={(v) => setLocale(v as Locale)}
              >
                <DropdownMenuRadioItem value="vi" onSelect={keepOpen}>
                  Tiếng Việt
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="en" onSelect={keepOpen}>
                  English
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-3 py-1.5" onSelect={() => setCustomizing(true)}>
                <RowIcon>
                  <SlidersHorizontal />
                </RowIcon>
                {t('account.customize')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <LayoutCustomizeDialog
        open={customizing}
        onOpenChange={setCustomizing}
        onCloseAutoFocus={returnFocus}
      />
      {planDialog?.({ open: planOpen, onOpenChange: setPlanOpen, onCloseAutoFocus: returnFocus })}
    </>
  );
}
