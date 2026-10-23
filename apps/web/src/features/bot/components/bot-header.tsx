import type { BotDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/errors';

import { useUpdateBot } from '../api/bots';

const TABS = [
  { to: '/app/bots/$botId', key: 'bots.tabs.overview', exact: true },
  { to: '/app/bots/$botId/knowledge', key: 'bots.tabs.knowledge', exact: false },
  { to: '/app/bots/$botId/settings', key: 'bots.tabs.settings', exact: false },
] as const;

/** Bot space header: back, name, on/off switch (optimistic) and the section tabs. */
export function BotHeader({ bot }: { bot: BotDto }) {
  const { t } = useTranslation();
  const update = useUpdateBot(bot.id);

  return (
    <header className="border-b bg-background px-6 pt-4">
      <Link
        to="/app/bots"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t('bots.back')}
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{bot.name}</h1>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          {bot.isActive ? t('bots.active') : t('bots.inactive')}
          <Switch
            checked={bot.isActive}
            aria-label={t('bots.toggleLabel')}
            className="data-[state=checked]:bg-success"
            onCheckedChange={(isActive) =>
              update.mutate(
                { isActive },
                {
                  onSuccess: () =>
                    toast.success(isActive ? t('bots.turnedOn') : t('bots.turnedOff')),
                  onError: (err) => toast.error(errorMessage(t, err)),
                },
              )
            }
          />
        </label>
      </div>
      <nav className="mt-3 -mb-px flex gap-5" aria-label={bot.name}>
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ botId: bot.id }}
            activeOptions={{ exact: tab.exact }}
            className="border-b-2 border-transparent pb-2.5 text-base text-muted-foreground transition-colors hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-medium data-[status=active]:text-foreground"
          >
            {t(tab.key)}
          </Link>
        ))}
      </nav>
    </header>
  );
}
