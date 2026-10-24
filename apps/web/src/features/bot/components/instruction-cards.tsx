import { Bot, MessageCircle, Pencil, Smile } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { useBot, useUpdateBot } from '../api/bots';

function InstructionEditor({
  botId,
  field,
  initial,
  onClose,
}: {
  botId: string;
  field: 'mission' | 'greeting';
  initial: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const [value, setValue] = useState(initial);
  const update = useUpdateBot(botId);
  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      { settings: { [field]: value } },
      {
        onSuccess: () => {
          toast.success(t('saved'));
          onClose();
        },
        onError: (error) => toast.error(errorMessage(common, error)),
      },
    );
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t(field === 'mission' ? 'missionTitle' : 'greetingTitle')}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="instruction-setting">{t('content')}</Label>
          <Textarea
            id="instruction-setting"
            rows={7}
            maxLength={field === 'mission' ? 4000 : 1000}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

export function InstructionCards({ botId }: { botId: string }) {
  const { t } = useTranslation('training');
  const bot = useBot(botId);
  const [editing, setEditing] = useState<'mission' | 'greeting' | null>(null);
  if (!bot.data) return <Skeleton className="h-36" />;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <article className="flex flex-col rounded-xl border border-primary bg-primary-soft/20 p-4">
          <Bot className="size-5 text-primary" aria-hidden />
          <h3 className="mt-2 text-sm font-semibold text-primary">{t('missionTitle')}</h3>
          <p className="mt-1 mb-3 flex-1 text-sm text-muted-foreground">
            {t('missionDescription')}
          </p>
          <Button size="sm" onClick={() => setEditing('mission')}>
            <Pencil />
            {t('editMission')}
          </Button>
        </article>
        <article className="flex flex-col rounded-xl border bg-card p-4">
          <MessageCircle className="size-5 text-primary" aria-hidden />
          <h3 className="mt-2 text-sm font-semibold text-primary">{t('greetingTitle')}</h3>
          <p className="mt-1 mb-3 flex-1 text-sm text-muted-foreground">
            {t('greetingDescription')}
          </p>
          <Button variant="outline" size="sm" onClick={() => setEditing('greeting')}>
            <Pencil />
            {t('editGreeting')}
          </Button>
        </article>
        <article className="flex flex-col rounded-xl border bg-card p-4">
          <Smile className="size-5 text-muted-foreground" aria-hidden />
          <h3 className="mt-2 text-sm font-semibold">{t('reactionTitle')}</h3>
          <p className="mt-1 mb-3 flex-1 text-sm text-muted-foreground">
            {t('reactionDescription')}
          </p>
          <Button variant="outline" size="sm" disabled>
            {t('reactionUnavailable')}
          </Button>
        </article>
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing ? (
          <InstructionEditor
            key={editing}
            botId={botId}
            field={editing}
            initial={bot.data.settings[editing]}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
    </>
  );
}
