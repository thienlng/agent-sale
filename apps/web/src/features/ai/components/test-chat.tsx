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
import { AttachmentThumbs, BotImages, BotVideos } from './test-chat-images';
import { TestChatSteps } from './test-chat-steps';

/** The pictures of a request as the playground sends them. */
type PlaygroundImages = Awaited<ReturnType<typeof toPlaygroundImages>> | undefined;

interface Turn {
  id: number;
  role: 'customer' | 'bot';
  content: string;
  result?: PlaygroundResponse;
  /** Object URLs of the pictures the customer sent with this turn. */
  images?: { id: number; url: string }[];
  error?: boolean;
  /** The failed request can be sent again as is ("AI đang bận", VL2-8). */
  retry?: { images: PlaygroundImages };
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
  // One id per test chat: a new chat never confirms the order or hold another chat prepared.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState('');
  const [reading, setReading] = useState(false);
  const attachments = useImageAttachments();
  const busy = playground.isPending || reading;

  /** No model for the tier (an admin must act), not a temporary outage (TM-3). */
  function notConfigured(err: ApiClientError): boolean {
    return err.details?.['reason'] === 'not_configured' || err.details?.['tier'] !== undefined;
  }

  function fail(err: Error, images: PlaygroundImages) {
    const imageIssue =
      !!images && err instanceof ApiClientError && /image|vision/i.test(err.message);
    const unavailable = err instanceof ApiClientError && err.code === 'AI_UNAVAILABLE';
    // A busy model or a failed request can be retried; a missing model or an image issue cannot.
    const retryable = !imageIssue && !(unavailable && notConfigured(err));
    setTurns((all) => [
      ...all,
      {
        id: ++seq.current,
        role: 'bot',
        error: true,
        ...(retryable ? { retry: { images } } : {}),
        content: imageIssue
          ? t('playground.imagesUnsupported')
          : unavailable
            ? t(notConfigured(err) ? 'playground.unavailable' : 'playground.busy')
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
    setDraft('');
    dispatch(
      content,
      sent.map(({ id, url }) => ({ id, url })),
      images,
    );
  }

  /** A quick reply sends its title only: the typed draft and queued images stay put. */
  function sendQuickReply(title: string) {
    if (!title.trim() || busy) return;
    dispatch(title.trim(), [], undefined);
  }

  function dispatch(
    content: string,
    sentImages: { id: number; url: string }[],
    images: PlaygroundImages,
  ) {
    const history: Turn[] = [
      ...turns,
      {
        id: ++seq.current,
        role: 'customer',
        content,
        ...(sentImages.length ? { images: sentImages } : {}),
      },
    ];
    setTurns(history);
    request(history, images);
  }

  /** Asks the bot to answer `history` (its error turns are left out of the request). */
  function request(history: Turn[], images: PlaygroundImages) {
    const messages = [
      ...(greeting ? [{ role: 'bot' as const, content: greeting }] : []),
      ...history
        .filter((h) => !h.error && (h.content.trim() || h.images?.length))
        .map((h) => ({ role: h.role, content: h.content.trim() || t('playground.imageOnly') })),
    ];
    // The playground stores no conversation: it tells the server what the bot already sent.
    const sentMediaUrls = history.flatMap(
      (h) =>
        h.result?.messages?.flatMap((m) => m.images.map((i) => i.url)) ??
        h.result?.images.map((i) => i.url) ??
        [],
    );
    playground.mutate(
      { messages, images, sentMediaUrls, sessionId },
      {
        onSuccess: (result) =>
          setTurns((all) => [
            ...all,
            { id: ++seq.current, role: 'bot', content: result.reply, result },
          ]),
        onError: (err) => fail(err, images),
      },
    );
  }

  /** "Thử lại" under a failed reply: drops that error and asks again, without re-adding the message. */
  function retry(failed: Turn) {
    if (busy || !failed.retry) return;
    const history = turns.filter((h) => h.id !== failed.id);
    setTurns(history);
    request(history, failed.retry.images);
  }

  function reset() {
    attachments.discardAll();
    setTurns([]);
    setSessionId(crypto.randomUUID());
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
          <h2 className="font-display text-lg font-semibold">{training('space.chat.title')}</h2>
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
                    <Bubble className="max-w-[85%] *:data-[slot=bubble-content]:bg-muted *:data-[slot=bubble-content]:text-foreground">
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
                // The owner-assistant launcher steps above the chips instead of covering one.
                <div data-assistant-avoid className="mt-auto flex flex-col gap-2 pt-6">
                  <p className="text-center text-sm text-muted-foreground">
                    {training('space.chat.suggestionsTitle')}
                  </p>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="truncate rounded-lg border border-primary/60 bg-primary-soft/50 px-3 py-2 text-left text-sm text-brand-text transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none"
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
                      {turn.result?.messages?.length ? (
                        // Each message the agent sent, in order, as Messenger shows it:
                        // its text bubbles, then its own album.
                        turn.result.messages.map((message, index, all) => (
                          <div key={index} className="flex flex-col gap-1">
                            <TurnBubbles turn={turn} text={message.text} />
                            {message.images.length ? (
                              <div className="mt-0.5">
                                <BotImages images={message.images} />
                              </div>
                            ) : null}
                            {message.videos?.length ? (
                              <div className="mt-0.5">
                                <BotVideos videos={message.videos} />
                              </div>
                            ) : null}
                            {/* Only the newest bot message offers its buttons, as on
                                Messenger; any customer turn after it retires them. */}
                            {turn === turns.at(-1) && index === all.length - 1 ? (
                              <QuickReplies
                                replies={message.quickReplies}
                                disabled={busy}
                                onPick={sendQuickReply}
                              />
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
                      {turn.retry && turn === turns.at(-1) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-1 w-fit"
                          disabled={busy}
                          onClick={() => retry(turn)}
                        >
                          <RotateCcw aria-hidden />
                          {training('retry')}
                        </Button>
                      ) : null}
                      {turn.result ? (
                        <MessageFooter className="flex-col items-start gap-1.5">
                          {turn.result.interrupted ? (
                            <span className="text-xs text-muted-foreground italic">
                              {t('playground.interrupted')}
                            </span>
                          ) : null}
                          <Outcome result={turn.result} />
                          <TestChatSteps result={turn.result} />
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
                  className="flex gap-1 self-start rounded-[1.1rem] rounded-bl-md bg-muted px-3.5 py-3"
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="typing-dot size-1.5 rounded-full bg-muted-foreground"
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
 * A message's quick-reply buttons. Picking one sends only its title as the
 * customer's next message; the draft and queued images are left alone.
 */
function QuickReplies({
  replies,
  disabled,
  onPick,
}: {
  replies: { title: string; payload: string }[] | undefined;
  disabled: boolean;
  onPick: (title: string) => void;
}) {
  const { t } = useTranslation();
  if (!replies?.length) return null;
  return (
    <div
      role="group"
      aria-label={t('playground.quickReplies.label')}
      className="flex flex-wrap gap-2 pt-1"
    >
      {replies.map((reply) => (
        <button
          key={reply.payload}
          type="button"
          disabled={disabled}
          onClick={() => onPick(reply.title)}
          className="min-h-8 rounded-full border border-primary/60 bg-background px-3.5 py-1 text-sm font-medium text-brand-text transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        >
          {reply.title}
        </button>
      ))}
    </div>
  );
}

/**
 * One chat message's bubbles. A bot answer reaches Messenger as several bubbles
 * (same split as the Meta inbox), so the test chat shows them the same way.
 */
function TurnBubbles({ turn, text }: { turn: Turn; text: string }) {
  // An image-only message has no text: show its album without an empty bubble
  // (a customer turn still needs its bubble for the attached thumbnails).
  if (!text.trim() && !turn.images?.length) return null;
  const parts = turn.role === 'bot' && !turn.error ? splitReply(text.slice(0, 2000)) : [text];
  return parts.map((part, index) => (
    <Bubble
      key={index}
      align={turn.role === 'customer' ? 'end' : 'start'}
      className={cn(
        'max-w-[85%]',
        // As in the owner assistant: the one typing (here the tester, as a customer) in the brand
        // colour on the right, the bot's answers on a neutral bubble on the left.
        turn.role === 'customer'
          ? '*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground'
          : turn.error
            ? '*:data-[slot=bubble-content]:bg-destructive-soft *:data-[slot=bubble-content]:text-destructive'
            : '*:data-[slot=bubble-content]:bg-muted *:data-[slot=bubble-content]:text-foreground',
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
