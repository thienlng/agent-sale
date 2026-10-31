import type { PlaygroundResponse } from '@agent-sales/contracts';
import { splitReply } from '@agent-sales/shared';
import { PanelRightClose, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
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
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { usePlayground } from '../api/playground';
import { toPlaygroundImages, useImageAttachments } from '../hooks/use-image-attachments';
import { TestChatComposer } from './test-chat-composer';
import { Outcome } from './test-chat-outcome';
import { AttachmentThumbs, BotImages } from './test-chat-images';
import { TestChatSteps } from './test-chat-steps';

interface Turn {
  id: number;
  role: 'customer' | 'bot';
  content: string;
  result?: PlaygroundResponse;
  /** Object URLs of the pictures the customer sent with this turn. */
  images?: { id: number; url: string }[];
  error?: boolean;
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
  const [reading, setReading] = useState(false);
  const attachments = useImageAttachments();
  const busy = playground.isPending || reading;

  function fail(err: Error, withImages: boolean) {
    const imageIssue =
      withImages && err instanceof ApiClientError && /image|vision/i.test(err.message);
    setTurns((all) => [
      ...all,
      {
        id: ++seq.current,
        role: 'bot',
        error: true,
        content: imageIssue
          ? t('playground.imagesUnsupported')
          : err instanceof ApiClientError && err.code === 'AI_UNAVAILABLE'
            ? t('playground.unavailable')
            : t('playground.error', { message: err.message }),
      },
    ]);
  }

  async function send(text: string) {
    const content = text.trim();
    const pending = attachments.items;
    if ((!content && !pending.length) || busy) return;
    setReading(true);
    let images;
    try {
      images = pending.length ? await toPlaygroundImages(pending) : undefined;
    } catch {
      setReading(false);
      setTurns((all) => [
        ...all,
        { id: ++seq.current, role: 'bot', error: true, content: t('playground.imageRead') },
      ]);
      return;
    }
    setReading(false);
    const sent = attachments.take();
    const history: Turn[] = [
      ...turns,
      {
        id: ++seq.current,
        role: 'customer',
        content,
        ...(sent.length ? { images: sent.map(({ id, url }) => ({ id, url })) } : {}),
      },
    ];
    setTurns(history);
    setDraft('');
    const messages = [
      ...(greeting ? [{ role: 'bot' as const, content: greeting }] : []),
      ...history
        .filter((h) => !h.error && (h.content.trim() || h.images?.length))
        .map((h) => ({ role: h.role, content: h.content.trim() || t('playground.imageOnly') })),
    ];
    playground.mutate(
      { messages, images },
      {
        onSuccess: (result) =>
          setTurns((all) => [
            ...all,
            { id: ++seq.current, role: 'bot', content: result.reply, result },
          ]),
        onError: (err) => fail(err, !!images),
      },
    );
  }

  function reset() {
    attachments.discardAll();
    setTurns([]);
  }

  return (
    <section
      aria-label={training('space.chat.title')}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex items-start gap-2 px-4 pt-4 pb-3">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={reset}
          disabled={!turns.length || busy}
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
              {!turns.length ? (
                <p className="text-center text-xs text-muted-foreground">
                  {t('playground.imageHint')}
                </p>
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
                      onClick={() => void send(s)}
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
                    <MessageContent className="gap-1">
                      {turn.result?.messages ? (
                        // Each message the agent sent, in order, as Messenger shows it:
                        // its text bubbles, then its own album.
                        turn.result.messages.map((message, index) => (
                          <div key={index} className="flex flex-col gap-1">
                            <TurnBubbles turn={turn} text={message.text} />
                            {message.images.length ? (
                              <div className="mt-0.5">
                                <BotImages images={message.images} />
                              </div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <>
                          <TurnBubbles turn={turn} text={turn.content} />
                          {turn.result?.images.length ? (
                            <div className="mt-1.5">
                              <BotImages images={turn.result.images} />
                            </div>
                          ) : null}
                        </>
                      )}
                      {turn.result ? (
                        <MessageFooter className="flex-col items-start gap-1.5">
                          {turn.result.interrupted ? (
                            <span className="text-xs text-muted-foreground italic">
                              {t('playground.interrupted')}
                            </span>
                          ) : null}
                          <Outcome result={turn.result} />
                          {turn.result.steps?.length ? (
                            <TestChatSteps steps={turn.result.steps} />
                          ) : null}
                        </MessageFooter>
                      ) : null}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
              {busy ? (
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

      <TestChatComposer
        draft={draft}
        onDraft={setDraft}
        attachments={attachments.items}
        attachError={attachments.error}
        onAddFiles={attachments.add}
        onRemoveFile={attachments.remove}
        onSend={() => void send(draft)}
        busy={busy}
      />
    </section>
  );
}

/**
 * One chat message's bubbles. A bot answer reaches Messenger as several bubbles
 * (same split as the Meta inbox), so the test chat shows them the same way.
 */
function TurnBubbles({ turn, text }: { turn: Turn; text: string }) {
  const parts = turn.role === 'bot' && !turn.error ? splitReply(text.slice(0, 2000)) : [text];
  return parts.map((part, index) => (
    <Bubble
      key={index}
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
        {index === 0 && turn.images?.length ? (
          <span className="mb-1 block">
            <AttachmentThumbs items={turn.images} />
          </span>
        ) : null}
        {part}
      </BubbleContent>
    </Bubble>
  ));
}
