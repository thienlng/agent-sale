import type { BotDto } from '@agent-sales/contracts';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NONE = 'none';

/** Workspace "Chỉnh sửa": pick the bot that answers the selected pages (or none). */
export function AssignBotDialog({
  open,
  count,
  bots,
  initialBotId,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  count: number;
  bots: readonly BotDto[];
  initialBotId: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (botId: string | null) => void;
}) {
  const { t } = useTranslation();
  const ti = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.integrations.${key}`, options ?? {});
  const [value, setValue] = useState(initialBotId ?? NONE);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ti('assignTitle')}</DialogTitle>
          <DialogDescription>{ti('assignBody', { count })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="assign-bot">{ti('assignLabel')}</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger id="assign-bot" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{ti('noBot')}</SelectItem>
              {bots.map((bot) => (
                <SelectItem key={bot.id} value={bot.id}>
                  {bot.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!bots.length ? (
            <p className="text-xs text-muted-foreground">{t('channelInbox.noBots')}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t('channelInbox.cancel')}
          </Button>
          <Button disabled={saving} onClick={() => onSave(value === NONE ? null : value)}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            {ti('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
