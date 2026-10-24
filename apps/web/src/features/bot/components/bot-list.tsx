import type { BotDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Bot, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';

import { useBots } from '../api/bots';
import { CreateBotDialog } from './create-bot-dialog';

export function BotList() {
  const { t, i18n } = useTranslation();
  const bots = useBots();
  const [creating, setCreating] = useState(false);
  const canManage = useCan('bots.manage');
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <section className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('bots.title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('bots.subtitle')}</p>
        </div>
        {canManage ? (
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus />
            {t('bots.create')}
          </Button>
        ) : null}
      </header>

      <div className="mt-8">
        {bots.isPending ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[4.25rem] rounded-xl" />
            ))}
          </div>
        ) : bots.data?.length ? (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {bots.data.map((bot: BotDto) => (
              <li key={bot.id}>
                <Link
                  to="/app/bots/$botId"
                  params={{ botId: bot.id }}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                    <Bot className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{bot.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {t(`industries.${bot.industry}`)}
                    </span>
                  </span>
                  <span className="hidden text-sm text-muted-foreground sm:block">
                    {t('bots.updated', { date: date.format(new Date(bot.updatedAt)) })}
                  </span>
                  <Badge
                    variant="secondary"
                    className={bot.isActive ? 'bg-success-soft text-success' : undefined}
                  >
                    {bot.isActive ? t('bots.active') : t('bots.inactive')}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
              <Bot className="size-7" aria-hidden />
            </span>
            <h2 className="mt-4 text-lg font-semibold">{t('bots.emptyTitle')}</h2>
            <p className="mt-1 max-w-sm text-muted-foreground">{t('bots.emptyBody')}</p>
            {canManage ? (
              <Button size="lg" className="mt-6" onClick={() => setCreating(true)}>
                <Plus />
                {t('bots.create')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <CreateBotDialog open={creating} onOpenChange={setCreating} />
    </section>
  );
}
