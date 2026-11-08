import { Industry, type WorkspaceDto } from '@agent-sales/contracts';
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
import { useAssistantForm } from '@/lib/assistant-context';
import { errorMessage } from '@/lib/errors';

import { useCreateBot } from '../api/bots';

export interface BotBusinessContext {
  workspace: Pick<WorkspaceDto, 'name' | 'industry'> | undefined;
  status: 'pending' | 'error' | 'success';
  onRetry: () => void;
}

export const BOT_NAME_MAX = 80;

/** The business's industry when a bot can be created for it, else null (unsupported or loading). */
export function botIndustryOf(business: BotBusinessContext | undefined): Industry | null {
  const parsed = Industry.safeParse(business?.workspace?.industry);
  return business?.status === 'success' && parsed.success ? parsed.data : null;
}

export function CreateBotDialog({
  open,
  onOpenChange,
  business,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business?: BotBusinessContext | undefined;
  /** The owner assistant's draft name, used when the dialog opens. */
  prefill?: { name?: string } | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateBot();
  const industry = botIndustryOf(business);
  const [name, setName] = useState('');
  // Each opening starts from the draft (or empty).
  const [shownOpen, setShownOpen] = useState(false);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setName(prefill?.name?.slice(0, BOT_NAME_MAX) ?? '');
  }
  useAssistantForm(
    'bot',
    () => [{ name: 'name', label: t('bots.name'), type: 'text', empty: !name.trim(), value: name }],
    (values) => {
      if (typeof values['name'] === 'string') setName(values['name'].slice(0, BOT_NAME_MAX));
    },
    { enabled: open && industry !== null },
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !industry) return;
    create.mutate(
      { name: trimmed, industry },
      {
        onSuccess: (bot) => {
          toast.success(t('bots.created'));
          onOpenChange(false);
          void navigate({ to: '/app/bots/$botId/integrations', params: { botId: bot.id } });
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
              maxLength={BOT_NAME_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('bots.namePlaceholder')}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bot-industry">{t('auth.industry')}</Label>
            <Input
              id="bot-industry"
              readOnly
              value={industry ? t(`industries.${industry}`) : (business?.workspace?.industry ?? '')}
              aria-describedby="bot-industry-policy"
            />
            <p id="bot-industry-policy" className="text-sm text-muted-foreground">
              {t('bots.businessIndustryPolicy', { name: business?.workspace?.name ?? '' })}
            </p>
            {!business || business.status === 'pending' ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('bots.businessLoading')}
              </p>
            ) : business.status === 'error' ? (
              <div role="alert" className="space-y-2 text-sm">
                <p>{t('bots.businessError')}</p>
                <Button type="button" variant="outline" onClick={business.onRetry}>
                  {t('bots.businessRetry')}
                </Button>
              </div>
            ) : !industry ? (
              <p role="alert" className="text-sm text-destructive">
                {t('bots.businessUnsupported', { industry: business.workspace?.industry ?? '' })}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !industry}>
              {create.isPending ? t('bots.creating') : t('bots.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
