import type { BotDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Bot, Plus, Settings, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCan } from '@/lib/permissions';

import { useBots } from '../api/bots';
import { BotActiveSwitch } from './bot-active-switch';
import { CreateBotDialog, type BotBusinessContext } from './create-bot-dialog';
import { DeleteBotDialog } from './delete-bot-dialog';

export function BotList({ business }: { business?: BotBusinessContext }) {
  const { t, i18n } = useTranslation();
  const bots = useBots();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BotDto | null>(null);
  const canManage = useCan('bots.manage');
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <TooltipProvider>
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
                <li
                  key={bot.id}
                  className="flex flex-wrap items-center transition-colors hover:bg-muted/60"
                >
                  <Link
                    to="/app/bots/$botId"
                    params={{ botId: bot.id }}
                    className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4 focus-visible:bg-muted focus-visible:outline-none"
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
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-2 pr-3">
                      <BotActiveSwitch bot={bot} />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild variant="ghost" size="icon">
                            <Link
                              to="/app/bots/$botId/settings"
                              params={{ botId: bot.id }}
                              aria-label={t('bots.settings')}
                            >
                              <Settings aria-hidden />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('bots.settings')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('bots.delete')}
                            className="hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleting(bot)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('bots.delete')}</TooltipContent>
                      </Tooltip>
                    </div>
                  ) : null}
                  {business?.status === 'success' &&
                  business.workspace &&
                  business.workspace.industry !== bot.industry ? (
                    <p className="w-full min-w-0 basis-full break-words border-t px-5 py-2 text-sm text-muted-foreground">
                      {t('bots.legacyIndustry', {
                        industry: t(`industries.${business.workspace.industry}`, {
                          defaultValue: business.workspace.industry,
                        }),
                      })}
                    </p>
                  ) : null}
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
        <CreateBotDialog business={business} open={creating} onOpenChange={setCreating} />
        <DeleteBotDialog bot={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
      </section>
    </TooltipProvider>
  );
}
