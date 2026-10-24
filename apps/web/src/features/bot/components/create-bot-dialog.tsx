import { Industry } from '@agent-sales/contracts';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/lib/errors';

import { useCreateBot } from '../api/bots';

export function CreateBotDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateBot();
  const [industry, setIndustry] = useState<Industry>('retail');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (!name) return;
    create.mutate(
      { name, industry },
      {
        onSuccess: (bot) => {
          toast.success(t('bots.created'));
          onOpenChange(false);
          void navigate({ to: '/app/bots/$botId', params: { botId: bot.id } });
        },
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('bots.createTitle')}</DialogTitle>
            <DialogDescription>{t('bots.createHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bot-name">{t('bots.name')}</Label>
            <Input
              id="bot-name"
              name="name"
              required
              maxLength={80}
              placeholder={t('bots.namePlaceholder')}
              autoFocus
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bot-industry">{t('auth.industry')}</Label>
            <Select value={industry} onValueChange={(v) => setIndustry(v as Industry)}>
              <SelectTrigger id="bot-industry" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Industry.options.map((i) => (
                  <SelectItem key={i} value={i}>
                    {t(`industries.${i}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('bots.creating') : t('bots.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
