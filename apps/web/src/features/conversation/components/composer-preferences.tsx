import { Settings2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { setEnterToSend } from '../lib/composer-preferences';

export function ComposerPreferences({
  userId,
  enterToSend,
}: {
  userId: string;
  enterToSend: boolean;
}) {
  const id = useId();
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.composeContinuity.${key}`);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={tr('settings')} title={tr('settings')}>
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={id} className="text-sm font-medium">
            {tr('enterToSend')}
          </label>
          <Switch
            id={id}
            checked={enterToSend}
            onCheckedChange={(value) => setEnterToSend(userId, value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {tr(enterToSend ? 'enterHint' : 'newlineHint')}
        </p>
        <p className="border-t pt-3 text-xs text-muted-foreground">{tr('draftNotice')}</p>
      </PopoverContent>
    </Popover>
  );
}
