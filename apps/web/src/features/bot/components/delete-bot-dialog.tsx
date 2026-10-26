import type { BotDto } from '@agent-sales/contracts';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/errors';

import { useBotsInUse, useDeleteBot } from '../api/bots';

/**
 * Confirms a soft delete. A bot that is on or that a page still uses needs its
 * name typed; an idle bot only needs a click (nothing would stop replying).
 */
export function DeleteBotDialog({
  bot,
  onOpenChange,
}: {
  bot: BotDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const remove = useDeleteBot();
  const inUse = useBotsInUse(Boolean(bot));
  const [typed, setTyped] = useState('');

  const connected = bot ? (inUse.data?.has(bot.id) ?? inUse.isPending) : false;
  // While the page list is unknown we stay on the safe side and ask for the name.
  const needsName = Boolean(bot && (bot.isActive || connected));
  const matches = !needsName || typed.trim() === bot?.name;

  function close(open: boolean) {
    if (!open) setTyped('');
    onOpenChange(open);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!bot || !matches) return;
    const { id, name } = bot;
    remove.mutate(id, {
      onSuccess: () => {
        toast.success(t('bots.deleted', { name }));
        close(false);
      },
      onError: (err) => toast.error(errorMessage(t, err)),
    });
  }

  return (
    <AlertDialog open={Boolean(bot)} onOpenChange={close}>
      <AlertDialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bots.deleteTitle', { name: bot?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('bots.deleteIntro')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t('bots.deleteEffects.stops')}</li>
            <li>{t('bots.deleteEffects.pages')}</li>
            <li>{t('bots.deleteEffects.kept')}</li>
          </ul>
          {needsName ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="delete-bot-name">
                {t('bots.deleteConfirmLabel', { name: bot?.name ?? '' })}
              </Label>
              <Input
                id="delete-bot-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="h-10"
              />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t('common.cancel')}</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!matches || remove.isPending}>
              {remove.isPending ? t('bots.deleting') : t('bots.delete')}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
