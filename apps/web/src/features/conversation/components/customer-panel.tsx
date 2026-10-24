import type { ConversationDto, UpdateConversationRequest } from '@agent-sales/contracts';
import { UsersRound } from 'lucide-react';
import { useState } from 'react';
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
import { CustomerAvatar } from './customer-avatar';

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
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <div className="border-b p-5">
        <div className="flex items-center gap-3">
          <CustomerAvatar conversation={c} />
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{c.customerName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{tr('customer')}</p>
          </div>
        </div>
      </div>
      <div className="space-y-5 p-5">
        <div>
          <Label className="text-xs text-muted-foreground">{tr('channel')}</Label>
          <p className="mt-1 text-sm">{c.provider === 'facebook' ? 'Facebook' : 'Instagram'}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{tr('customerId')}</Label>
          <p className="mt-1 break-all text-sm">{c.customerId}</p>
        </div>
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
            disabled={busy}
            onClick={() => onChange({ assignToMe: !c.assigneeId })}
          >
            {tr(c.assigneeId ? 'unassign' : 'claim')}
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`note-${c.id}`}>{tr('notes')}</Label>
          <Textarea
            id={`note-${c.id}`}
            value={note ?? c.note}
            placeholder={tr('notesPlaceholder')}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-28 resize-y"
            maxLength={10000}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || note === null || note === c.note}
            onClick={() => onChange({ note: note ?? c.note })}
          >
            {tr('saveNotes')}
          </Button>
        </div>
      </div>
    </>
  );
}
