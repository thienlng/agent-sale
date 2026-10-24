import type { UpdateConversationRequest } from '@agent-sales/contracts';
import { ArrowLeft, Bot, CircleAlert, Loader2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConversation, useInboxActions } from '../api/inbox';
import { CustomerAvatar } from './customer-avatar';
import { CustomerPanel } from './customer-panel';
import { MessageComposer } from './message-composer';
import { MessageThread } from './message-thread';

/** An open conversation: header with takeover, thread, composer and customer panel. */
export function ConversationView({
  id,
  onBack,
  botId,
}: {
  id: string;
  onBack: () => void;
  botId: string | null;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const detail = useConversation(id);
  const { update } = useInboxActions(id);
  const [details, setDetails] = useState(false);
  const c = detail.data?.conversation;

  async function change(body: UpdateConversationRequest) {
    try {
      await update.mutateAsync(body);
      toast.success(tr('updated'));
    } catch {
      toast.error(tr('loadError'));
    }
  }
  if (detail.isPending)
    return (
      <div role="status" className="flex flex-1 items-center justify-center">
        <Loader2 className="mr-2 size-5 animate-spin" />
        {tr('loading')}
      </div>
    );
  if (detail.isError || !c)
    return (
      <div
        className="flex min-w-0 flex-1 flex-col items-center justify-center p-6 text-center"
        role="alert"
      >
        <CircleAlert className="mb-3 size-8 text-destructive" />
        <p>{tr('loadError')}</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={onBack}>
            {tr('back')}
          </Button>
          <Button onClick={() => void detail.refetch()}>{tr('retry')}</Button>
        </div>
      </div>
    );
  const windowClosed = Date.now() - Date.parse(c.lastInboundAt) >= 86400000;
  return (
    <div className="flex min-w-0 flex-1">
      <div className={cn('flex min-w-0 flex-1 flex-col', details && 'hidden xl:flex')}>
        <header className="flex min-h-20 flex-wrap items-center gap-3 border-b px-4 py-3">
          <Button
            size="icon"
            variant="ghost"
            className="md:hidden"
            aria-label={tr('back')}
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <CustomerAvatar conversation={c} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{c.customerName}</h2>
            <span className="text-xs text-muted-foreground">
              {c.provider === 'facebook' ? 'Facebook Messenger' : 'Instagram'}
            </span>
          </div>
          <Button
            size="sm"
            variant={c.mode === 'bot' ? 'secondary' : 'outline'}
            disabled={update.isPending || (c.mode === 'human' && !botId)}
            onClick={() => void change({ mode: c.mode === 'bot' ? 'human' : 'bot' })}
          >
            {c.mode === 'bot' ? <Bot /> : <UserRound />}
            {tr(c.mode === 'bot' ? 'takeOver' : 'resumeBot')}
          </Button>
          <Button size="sm" variant="ghost" className="xl:hidden" onClick={() => setDetails(true)}>
            {tr('details')}
          </Button>
        </header>
        <MessageThread messages={detail.data.messages} />
        <MessageComposer id={id} botId={botId} windowClosed={windowClosed} />
      </div>
      <aside
        className={cn(
          'w-full shrink-0 overflow-y-auto border-l bg-background xl:block xl:w-72 2xl:w-80',
          details ? 'block' : 'hidden',
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          className="m-3 xl:hidden"
          onClick={() => setDetails(false)}
        >
          <ArrowLeft />
          {tr('back')}
        </Button>
        <CustomerPanel
          conversation={c}
          busy={update.isPending}
          onChange={(body) => void change(body)}
        />
      </aside>
    </div>
  );
}
