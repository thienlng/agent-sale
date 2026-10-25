import type { BotDto } from '@agent-sales/contracts';
import { Link, useMatchRoute } from '@tanstack/react-router';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Code,
  House,
  Image,
  Info,
  Megaphone,
  Package,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

import { BotActiveSwitch } from './bot-active-switch';

type Target =
  | '/app/bots/$botId'
  | '/app/bots/$botId/products'
  | '/app/bots/$botId/instructions'
  | '/app/bots/$botId/knowledge'
  | '/app/bots/$botId/integrations'
  | '/app/bots/$botId/actions'
  | '/app/bots/$botId/media'
  | '/app/bots/$botId/settings'
  | '/app/bots/$botId/quick-replies'
  | '/app/bots/$botId/history'
  | '/app/bots/$botId/ads-tool';

interface Item {
  to: Target;
  key: string;
  icon?: LucideIcon;
}

const MAIN: Item[] = [
  { to: '/app/bots/$botId', key: 'home', icon: House },
  { to: '/app/bots/$botId/products', key: 'products', icon: Package },
  { to: '/app/bots/$botId/instructions', key: 'instructions', icon: BookOpen },
  { to: '/app/bots/$botId/knowledge', key: 'information', icon: Info },
  { to: '/app/bots/$botId/integrations', key: 'integrations', icon: Code },
  { to: '/app/bots/$botId/actions', key: 'actions', icon: Zap },
  { to: '/app/bots/$botId/media', key: 'media', icon: Image },
];
const SETTINGS: Item[] = [
  { to: '/app/bots/$botId/settings', key: 'botSettings' },
  { to: '/app/bots/$botId/quick-replies', key: 'quickReplies' },
  { to: '/app/bots/$botId/history', key: 'history' },
];
const DEVELOPMENT: Item[] = [{ to: '/app/bots/$botId/ads-tool', key: 'adsTool', icon: Megaphone }];

const itemClass =
  'flex shrink-0 items-center gap-2.5 border-r-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-[status=active]:border-primary data-[status=active]:bg-primary-soft data-[status=active]:font-medium data-[status=active]:text-primary';

function NavLink({ botId, item, className }: { botId: string; item: Item; className?: string }) {
  const { t } = useTranslation('training');
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      params={{ botId }}
      activeOptions={{ exact: item.to === '/app/bots/$botId' }}
      className={cn(itemClass, className)}
    >
      {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
      {t(`space.nav.${item.key}`)}
    </Link>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <p className="px-4 pt-4 pb-2 text-sm font-semibold">{children}</p>;
}

/** Settings group: collapsible, opened whenever one of its pages is active. */
function SettingsGroup({ botId }: { botId: string }) {
  const { t } = useTranslation('training');
  const matchRoute = useMatchRoute();
  const childActive = SETTINGS.some((i) => Boolean(matchRoute({ to: i.to, params: { botId } })));
  const [open, setOpen] = useState(childActive);
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={cn(itemClass, 'w-full')}>
        <Settings aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 text-left">{t('space.nav.settings')}</span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {SETTINGS.map((item) => (
          <NavLink key={item.to} botId={botId} item={item} className="pl-10" />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The bot space menu (Preny layout): back + name + on/off on top, then the
 * main sections, the settings group and the development tools. Below `lg` the
 * same pages are a horizontally scrolling strip.
 */
export function TrainingNav({ bot }: { bot: BotDto }) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();

  return (
    <div className="flex shrink-0 flex-col border-b bg-background lg:w-56 lg:border-r lg:border-b-0">
      <div className="flex items-center gap-2 px-3 py-3">
        <Link
          to="/app/bots"
          aria-label={common('bots.back')}
          title={common('bots.back')}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-semibold" title={bot.name}>
          {bot.name}
        </h1>
        <BotActiveSwitch bot={bot} />
      </div>

      <nav aria-label={t('menu')} className="hidden flex-col pb-4 lg:flex">
        <GroupLabel>{t('space.nav.main')}</GroupLabel>
        {MAIN.map((item) => (
          <NavLink key={item.to} botId={bot.id} item={item} />
        ))}
        <SettingsGroup botId={bot.id} />
        <GroupLabel>{t('space.nav.development')}</GroupLabel>
        {DEVELOPMENT.map((item) => (
          <NavLink key={item.to} botId={bot.id} item={item} />
        ))}
      </nav>

      <nav aria-label={t('menu')} className="flex overflow-x-auto lg:hidden">
        {[...MAIN, ...SETTINGS, ...DEVELOPMENT].map((item) => (
          <NavLink
            key={item.to}
            botId={bot.id}
            item={item}
            className="border-r-0 border-b-2 px-3 data-[status=active]:border-primary"
          />
        ))}
      </nav>
    </div>
  );
}
