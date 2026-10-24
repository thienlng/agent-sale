import type { BotDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/errors';

import { useUpdateBot } from '../api/bots';

/** Bot space header: back, name, on/off switch (optimistic) and the section tabs. */
export function BotHeader({ bot }: { bot: BotDto }) {
  const { t } = useTranslation();
  const update = useUpdateBot(bot.id);

  return (
    <header className="border-b bg-background px-4 py-4 md:px-6">
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
    </header>
  );
}
