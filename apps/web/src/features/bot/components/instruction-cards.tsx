import { Bot, MessageCircle, Pencil } from 'lucide-react';
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

/** The "Giới thiệu" rows: the bot's mission and greeting, each editable in a dialog. */
export function IntroductionRows({ botId }: { botId: string }) {
  const { t } = useTranslation('training');
  const bot = useBot(botId);
  const [editing, setEditing] = useState<'mission' | 'greeting' | null>(null);
  if (!bot.data) return <Skeleton className="h-24" />;
  const rows = [
    { field: 'mission', icon: Bot, title: t('missionTitle'), edit: t('editMission') },
    { field: 'greeting', icon: MessageCircle, title: t('greetingTitle'), edit: t('editGreeting') },
  ] as const;
  return (
    <>
      <ul>
        {rows.map(({ field, icon: Icon, title, edit }) => (
          <li key={field} className="flex items-start gap-3 border-b px-3 py-3 last:border-b-0">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">{title}</h3>
              <p className="mt-1 line-clamp-3 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                {bot.data.settings[field]}
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label={edit} onClick={() => setEditing(field)}>
              <Pencil />
            </Button>
          </li>
        ))}
      </ul>
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
