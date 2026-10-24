import { Link } from '@tanstack/react-router';
import {
  BookOpen,
  Boxes,
  History,
  Home,
  Image,
  MessageSquareText,
  Plug,
  Settings,
  Workflow,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

const sections = [
  { to: '/app/bots/$botId', key: 'home', icon: Home, exact: true },
  { to: '/app/bots/$botId/products', key: 'products', icon: Boxes },
  { to: '/app/bots/$botId/instructions', key: 'instructions', icon: Workflow },
  { to: '/app/bots/$botId/knowledge', key: 'information', icon: BookOpen },
  { to: '/app/bots/$botId/integrations', key: 'integrations', icon: Plug },
  { to: '/app/bots/$botId/media', key: 'media', icon: Image },
  { to: '/app/bots/$botId/settings', key: 'settings', icon: Settings },
  { to: '/app/bots/$botId/quick-replies', key: 'quickReplies', icon: MessageSquareText },
  { to: '/app/bots/$botId/history', key: 'history', icon: History },
] as const;

export function TrainingNav({ botId }: { botId: string }) {
  const { t } = useTranslation('training');
  return (
    <nav
      aria-label={t('menu')}
      className="flex gap-1 overflow-x-auto border-b bg-sidebar p-2 lg:w-44 lg:shrink-0 lg:flex-col lg:overflow-x-visible lg:border-r lg:border-b-0 lg:p-3"
    >
      <p className="mb-3 hidden px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase lg:block">
        {t('training')}
      </p>
      {sections.map(({ to, key, icon: Icon, ...options }) => (
        <Link
          key={to}
          to={to}
          params={{ botId }}
          activeOptions={{ exact: 'exact' in options }}
          className="flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-primary-soft data-[status=active]:font-medium data-[status=active]:text-primary"
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
