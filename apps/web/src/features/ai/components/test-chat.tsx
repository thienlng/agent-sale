import type { PlaygroundResponse } from '@agent-sales/contracts';
import {
  BadgeCheck,
  CircleHelp,
  Headset,
  PanelRightClose,
  RotateCcw,
  SendHorizontal,
  ShieldAlert,
} from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { usePlayground } from '../api/playground';

interface Turn {
  id: number;
  role: 'customer' | 'bot';
  content: string;
  result?: PlaygroundResponse;
  error?: boolean;
}

/** What happened to a bot turn, shown under its bubble like a delivery receipt. */
function Outcome({ result }: { result: PlaygroundResponse }) {
  const { t } = useTranslation();
  const used = result.sources.filter((s) => s.used);
  const chip =
    'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';
  return (
    <div className="flex flex-col items-start gap-1.5">
      {result.outcome === 'answered'
        ? used.map((s) => (
            <span key={s.faqId} className={cn(chip, 'bg-success-soft text-success')}>
              <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{t('playground.source', { question: s.question })}</span>
            </span>
          ))
        : null}
      {result.outcome === 'fallback' ? (
        <span className={cn(chip, 'bg-warning-soft text-warning')}>
          {result.guardrail?.startsWith('ungrounded') ? (
            <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <CircleHelp className="size-3.5 shrink-0" aria-hidden />
          )}
          {result.guardrail?.startsWith('ungrounded')
            ? t('playground.guardrail')
            : t('playground.fallback')}
        </span>
      ) : null}
      {result.outcome === 'handoff' ? (
        <span className={cn(chip, 'bg-secondary text-secondary-foreground')}>
          <Headset className="size-3.5 shrink-0" aria-hidden />
          {t('playground.handoff')}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {t('playground.meta', {
          model: result.model,
          tokens:
            result.usage.inputTokens + result.usage.cachedInputTokens + result.usage.outputTokens,
          seconds: (result.latencyMs / 1000).toFixed(1),
        })}
      </span>
    </div>
  );
}

/**
 * The owner plays the customer; the bot answers exactly as it would on a
 * channel, and every reply says where it came from.
 */
export function TestChat({
  botId,
  greeting,
  suggestions = [],
  onHide,
}: {
  botId: string;
  greeting: string;
  /** Questions offered as one-click starters while the chat is empty (the bot's first FAQs). */
  suggestions?: readonly string[];
  /** Shown as a close button when the panel is docked. */
  onHide?: () => void;
}) {
  const { t } = useTranslation();
  const { t: training } = useTranslation('training');
  const playground = usePlayground(botId);
  const seq = useRef(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');

  function send(text: string) {
    const content = text.trim();
    if (!content || playground.isPending) return;
    const history: Turn[] = [...turns, { id: ++seq.current, role: 'customer', content }];
    setTurns(history);
    setDraft('');
    const messages = [
      ...(greeting ? [{ role: 'bot' as const, content: greeting }] : []),
      ...history
        .filter((h) => !h.error && h.content.trim())
        .map((h) => ({ role: h.role, content: h.content })),
    ];
    playground.mutate(messages, {
      onSuccess: (result) =>
        setTurns((all) => [
          ...all,
          { id: ++seq.current, role: 'bot', content: result.reply, result },
        ]),
      onError: (err) =>
        setTurns((all) => [
          ...all,
          {
            id: ++seq.current,
            role: 'bot',
            error: true,
            content:
              err instanceof ApiClientError && err.code === 'AI_UNAVAILABLE'
                ? t('playground.unavailable')
                : t('playground.error', { message: err.message }),
          },
        ]),
    });
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <section
      aria-label={training('space.chat.title')}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex items-start gap-2 px-4 pt-4 pb-3">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => setTurns([])}
          disabled={!turns.length || playground.isPending}
          aria-label={training('space.chat.reset')}
          title={training('space.chat.reset')}
        >
          <RotateCcw />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <h2 className="text-lg font-semibold text-primary">{training('space.chat.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{training('space.chat.subtitle')}</p>
        </div>
        {onHide ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onHide}
            aria-label={t('playground.hide')}
            title={t('playground.hide')}
          >
            <PanelRightClose />
          </Button>
        ) : null}
      </header>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 px-4 py-5">
              {greeting ? (
                <Message>
                  <MessageContent>
                    <Bubble className="max-w-[85%] *:data-[slot=bubble-content]:bg-bubble-bot *:data-[slot=bubble-content]:text-primary-foreground">
                      <BubbleContent className="rounded-[1.1rem] rounded-bl-md text-base">
                        {greeting}
                      </BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              ) : null}
              {!turns.length && suggestions.length ? (
                <div className="mt-auto flex flex-col gap-2 pt-6">
                  <p className="text-center text-sm text-muted-foreground">
                    {training('space.chat.suggestionsTitle')}
                  </p>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="truncate rounded-lg border border-primary/60 bg-primary-soft/50 px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-primary-soft focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {turns.map((turn) => (
                <MessageScrollerItem
                  key={turn.id}
                  messageId={String(turn.id)}
                  scrollAnchor={turn.role === 'customer'}
                >
                  <Message
                    align={turn.role === 'customer' ? 'end' : 'start'}
                    className="animate-[bubble-in_220ms_ease-out]"
                  >
                    <MessageContent>
                      <Bubble
                        align={turn.role === 'customer' ? 'end' : 'start'}
                        className={cn(
                          'max-w-[85%]',
                          turn.role === 'customer'
                            ? '*:data-[slot=bubble-content]:bg-bubble-customer *:data-[slot=bubble-content]:text-foreground'
                            : turn.error
                              ? '*:data-[slot=bubble-content]:bg-destructive-soft *:data-[slot=bubble-content]:text-destructive'
                              : '*:data-[slot=bubble-content]:bg-bubble-bot *:data-[slot=bubble-content]:text-primary-foreground',
                        )}
                      >
                        <BubbleContent
                          className={cn(
                            'rounded-[1.1rem] text-base whitespace-pre-line',
                            turn.role === 'customer' ? 'rounded-br-md' : 'rounded-bl-md',
                          )}
                        >
                          {turn.content}
                        </BubbleContent>
                      </Bubble>
                      {turn.result ? (
                        <MessageFooter>
                          <Outcome result={turn.result} />
                        </MessageFooter>
                      ) : null}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
              {playground.isPending ? (
                <div
                  role="status"
                  aria-label={t('playground.thinking')}
                  className="flex gap-1 self-start rounded-[1.1rem] rounded-bl-md bg-primary-soft px-3.5 py-3"
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="typing-dot size-1.5 rounded-full bg-primary"
                      style={{ animationDelay: `${i * 200}ms` }}
                    />
                  ))}
                </div>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form onSubmit={submit} className="border-t p-3">
        <div className="flex items-end gap-2 rounded-2xl border bg-background p-1.5 pl-3 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder={training('space.chat.placeholder')}
            aria-label={training('space.chat.placeholder')}
            className="max-h-32 min-h-9 resize-none border-0 bg-transparent px-0 py-2 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            type="submit"
            size="icon-lg"
            className="rounded-xl"
            disabled={!draft.trim() || playground.isPending}
            aria-label={t('playground.send')}
          >
            <SendHorizontal />
          </Button>
        </div>
      </form>
    </section>
  );
}
