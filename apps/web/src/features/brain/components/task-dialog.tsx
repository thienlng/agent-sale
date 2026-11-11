import { TASK_TITLE_MAX } from '@agent-sales/contracts';
import { useState, type FormEvent } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/lib/permissions';
import { useSession } from '@/lib/session';

import { useCreateTask, useTaskAssignees } from '../api/brain';

/** What the dialog is opened for: a customer of Today or of the inbox. */
export interface TaskSubject {
  conversationId?: string | undefined;
  contactId?: string | null | undefined;
  customerName?: string | undefined;
}

/**
 * Due times are entered and shown in Asia/Ho_Chi_Minh (UTC+7, no daylight saving), the same day
 * Today uses for "due today", whatever the browser's time zone.
 */
const HCM_OFFSET_MS = 7 * 3_600_000;
/** `YYYY-MM-DDTHH:mm` in Asia/Ho_Chi_Minh, for a datetime-local input. */
export function toLocalInput(d: Date): string {
  return new Date(d.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 16);
}
/** A datetime-local value read as Asia/Ho_Chi_Minh time. */
export function fromLocalInput(value: string): Date {
  return new Date(`${value}:00+07:00`);
}
/** Two hours from now, on the hour: a sensible "later today". */
function defaultDue(now = new Date()): string {
  const d = new Date(now.getTime() + 2 * 3_600_000);
  d.setUTCMinutes(0, 0, 0);
  return toLocalInput(d);
}

const ME = 'me';
const NOBODY = 'none';

/** "Thêm việc": a task for me (default), nobody or a teammate, linked to the customer. */
export function TaskDialog({
  subject,
  onOpenChange,
}: {
  /** Open while set. */
  subject: TaskSubject | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={subject !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {subject ? <TaskForm subject={subject} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ subject, onDone }: { subject: TaskSubject; onDone: () => void }) {
  const { t } = useTranslation('brain');
  const session = useSession();
  const canAssign = useCan('contacts.view_all');
  const assignees = useTaskAssignees({ enabled: canAssign });
  const create = useCreateTask();
  const [title, setTitle] = useState(
    subject.customerName ? t('task.defaultTitle', { name: subject.customerName }) : '',
  );
  const [due, setDue] = useState(defaultDue);
  const [assignee, setAssignee] = useState(ME);
  const [note, setNote] = useState('');
  const me = session?.user.id;

  function submit(event: FormEvent) {
    event.preventDefault();
    const assigneeUserId = assignee === ME ? (me ?? null) : assignee === NOBODY ? null : assignee;
    create.mutate(
      {
        title: title.trim(),
        note: note.trim() || null,
        dueAt: due ? fromLocalInput(due).toISOString() : null,
        assigneeUserId,
        ...(subject.conversationId ? { conversationId: subject.conversationId } : {}),
        ...(subject.contactId ? { contactId: subject.contactId } : {}),
        source: 'today',
      },
      {
        onSuccess: () => {
          toast.success(t('task.created'));
          onDone();
        },
        onError: () => toast.error(t('task.error')),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t('task.dialogTitle')}</DialogTitle>
        <DialogDescription>{t('task.dialogDescription')}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-title">{t('task.title')}</Label>
        <Input
          id="task-title"
          value={title}
          maxLength={TASK_TITLE_MAX}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="task-due">{t('task.due')}</Label>
          <Input
            id="task-due"
            type="datetime-local"
            value={due}
            aria-describedby="task-due-zone"
            onChange={(e) => setDue(e.target.value)}
          />
          <span id="task-due-zone" className="sr-only">
            {t('task.dueHint')}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="task-assignee">{t('task.assignee')}</Label>
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger id="task-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ME}>{t('task.me')}</SelectItem>
              <SelectItem value={NOBODY}>{t('task.unassigned')}</SelectItem>
              {(assignees.data ?? [])
                .filter((m) => m.userId !== me)
                .map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-note">{t('task.note')}</Label>
        <Textarea
          id="task-note"
          value={note}
          rows={3}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('task.cancel')}
        </Button>
        <Button type="submit" disabled={create.isPending || !title.trim()}>
          {t('task.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
