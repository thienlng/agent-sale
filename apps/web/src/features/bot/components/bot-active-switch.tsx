import type { BotDto } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/errors';

import { useUpdateBot } from '../api/bots';

/** On/off switch for the bot; optimistic, rolled back with a toast on error. */
export function BotActiveSwitch({ bot }: { bot: BotDto }) {
  const { t } = useTranslation();
  const update = useUpdateBot(bot.id);
  return (
    <Switch
      checked={bot.isActive}
      aria-label={t('bots.toggleLabel')}
      title={bot.isActive ? t('bots.active') : t('bots.inactive')}
      className="shrink-0 data-[state=checked]:bg-success"
      onCheckedChange={(isActive) =>
        update.mutate(
          { isActive },
          {
            onSuccess: () => toast.success(isActive ? t('bots.turnedOn') : t('bots.turnedOff')),
            onError: (err) => toast.error(errorMessage(t, err)),
          },
        )
      }
    />
  );
}
