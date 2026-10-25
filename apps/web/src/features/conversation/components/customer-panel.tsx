import type { ConversationDto, UpdateConversationRequest } from '@agent-sales/contracts';
import { UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/lib/session';

/** Customer details, status, assignment and internal notes. */
export function CustomerPanel({
  conversation: c,
  busy,
  onChange,
}: {
  conversation: ConversationDto;
  busy: boolean;
  onChange: (body: UpdateConversationRequest) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const [draft, setDraft] = useState<{ text: string; revision: number } | null>(null);
  const session = useSession();
  const mine = c.assigneeId === session?.user.id;
  const note = draft?.text;
  useEffect(() => {
    if (draft && draft.text === c.note && draft.revision !== c.revision) setDraft(null);
  }, [c.note, c.revision, draft]);
  return (
    <>
      <div className="space-y-5 p-5">
        <div>
          <Label className="text-xs text-muted-foreground">{tr('channel')}</Label>
          <p className="mt-1 text-sm">{c.provider === 'facebook' ? 'Facebook' : 'Instagram'}</p>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{tr('customerId')}</summary>
          <Label className="sr-only">{tr('customerId')}</Label>
          <p className="mt-1 break-all text-sm">{c.customerId}</p>
        </details>
        <div>
          <Label className="mb-2">{tr('status')}</Label>
          <Select
            value={c.status}
            disabled={busy}
            onValueChange={(status) => onChange({ status: status as 'open' | 'resolved' })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{tr('open')}</SelectItem>
              <SelectItem value="resolved">{tr('resolved')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-xl border p-3">
          <p className="flex items-center gap-2 text-sm">
            <UsersRound className="size-4 text-muted-foreground" />
            {tr(c.assigneeId ? 'assigned' : 'unassigned')}
          </p>
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="outline"
            disabled={busy || Boolean(c.assigneeId && !mine)}
            onClick={() => onChange({ assignToMe: !mine, expectedRevision: c.revision })}
          >
            {tr(mine ? 'unassign' : c.assigneeId ? 'assigned' : 'claim')}
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`note-${c.id}`}>{tr('notes')}</Label>
          <Textarea
            id={`note-${c.id}`}
            value={note ?? c.note}
            placeholder={tr('notesPlaceholder')}
            onChange={(event) =>
              setDraft({ text: event.target.value, revision: draft?.revision ?? c.revision })
            }
            className="min-h-28 resize-y"
            maxLength={10000}
          />
          {draft && draft.revision !== c.revision && draft.text !== c.note ? (
            <p role="status" className="text-xs text-warning">
              {tr('sales.noteChanged')}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!draft}
              onClick={() => setDraft(null)}
            >
              {tr('sales.resetNote')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || note === undefined || note === c.note}
              onClick={() =>
                onChange({ note: note ?? c.note, expectedRevision: draft?.revision ?? c.revision })
              }
            >
              {tr('saveNotes')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
