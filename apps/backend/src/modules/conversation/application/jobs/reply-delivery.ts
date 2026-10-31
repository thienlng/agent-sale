import type { ImageInput } from '@agent-sales/ai-core';
import type { InboxMessageDto } from '@agent-sales/contracts';
import { splitReply } from '@agent-sales/shared';
import type { Logger } from '@nestjs/common';
import type {
  MessageSink,
  OutgoingMessage,
  QuickReply,
  ReplyResult,
} from '../../../ai/api/index.js';
import type { BotView } from '../../../bot/api/index.js';
import type { ChannelFacade, PendingMetaEvent } from '../../../channel/api/index.js';
import type { ConversationFacade } from '../../api/conversation.facade.js';
import type { ImageFetcher } from '../ports/image-fetcher.js';

/** Spec §7: at least this long between two consecutive sends (each `send_message` and the final answer). */
export const SEND_GAP_MS = 800;
const MAX_BOT_IMAGES = 3;
const MAX_TEXT_CHARS = 2000;
const MAX_VISION_IMAGES = 3;
/** Meta shows "typing…" for about 20 s; refresh it while the model is still working. */
const TYPING_REFRESH_MS = 10_000;

/** Clock of the send pacing; injectable so tests can use fake timers or a recorder. */
export interface ReplyPacing {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export const REPLY_PACING = Symbol('REPLY_PACING');
export const realPacing: ReplyPacing = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Why nothing more goes out in this turn. */
export type DeliveryStop = 'takeover' | 'failed' | 'newer';

/**
 * The outbound side of one customer turn: the agent's `send_message` calls (through `sink()`) and
 * the final answer go out in order through the same reserve → deliver → record path, paced, and
 * stop for good after a takeover, an undelivered message or (unless told to finish) a newer
 * customer message. Keys: `<key>:s<n>` (+ `:t2`… bubbles, `:img` album) per send, `<key>` for the final.
 */
export class ReplyDelivery {
  /** The first message committed in this turn (any status): later ones are follow-ups. */
  first: InboxMessageDto | null = null;
  /** Statuses of every message committed in this turn (the answer is billed on them). */
  private readonly statuses = new Set<InboxMessageDto['status']>();
  stop: DeliveryStop | null = null;
  /** Why the turn stopped with `failed` when nothing was committed (rethrown by the processor). */
  failure: unknown = null;
  /** Id of the newest message committed in this turn. */
  lastId: string | null = null;
  private sends = 0;
  /** Messages delivered by the current send (kept when it throws midway). */
  private delivered = 0;
  private lastSendAt: number | null = null;
  private watchNewer: boolean;

  constructor(
    private readonly deps: {
      inbox: ConversationFacade;
      channels: ChannelFacade;
      logger: Logger;
      pacing: ReplyPacing;
    },
    private readonly turn: {
      job: PendingMetaEvent;
      conversationId: string;
      revision: number;
      key: string;
      /** False on the last allowed re-run: a newer customer message no longer stops this turn. */
      watchNewer: boolean;
    },
  ) {
    this.watchNewer = turn.watchNewer;
  }

  /** A human took over (or the bot was switched off): nothing more goes out, no hand-off. */
  get takenOver(): boolean {
    return this.stop === 'takeover';
  }

  /** Anything was committed (sent, failed or unknown): the turn is not silent. */
  get attempted(): boolean {
    return this.first !== null;
  }

  sink(): MessageSink {
    return { send: (message) => this.sendMessage(message) };
  }

  /** Whether the same customer wrote after this turn's event (never throws). */
  hasNewerMessage(): Promise<boolean> {
    const { job } = this.turn;
    return this.deps.channels
      .hasNewerCustomerEvent(job.connectionId, job.event.senderExternalId, job.id)
      .catch(() => false);
  }

  /** A newer customer message stopped the sends but is gone after the run: send the final. */
  clearNewerStop(): void {
    if (this.stop === 'newer') this.stop = null;
  }

  /** From now on a newer customer message no longer stops this turn (a hand-off goes out whole). */
  stopWatchingNewer(): void {
    this.watchNewer = false;
    this.clearNewerStop();
  }

  /**
   * One `send_message` call: its text bubbles, then its pictures as one album. With quick replies
   * the album goes first, so the buttons stay on the last message Messenger shows.
   */
  private async sendMessage(message: OutgoingMessage): Promise<{ delivered: number }> {
    const n = ++this.sends;
    this.delivered = 0;
    if (this.stop || (await this.stopForNewer())) return { delivered: 0 };
    await this.pace();
    // The customer may have written while we waited.
    if (await this.stopForNewer()) return { delivered: 0 };
    try {
      const text = message.text?.trim();
      const key = `${this.turn.key}:s${n}`;
      const images = message.images.length > 0;
      if (text && images && message.quickReplies?.length) {
        await this.sendImages(message.images, `${key}:img`);
        if (!this.stop && !(await this.stopForNewer()))
          await this.sendText(text, key, message.quickReplies);
      } else {
        if (text) await this.sendText(text, key, message.quickReplies);
        if (!this.stop && images && !(text && (await this.stopForNewer())))
          await this.sendImages(message.images, `${key}:img`);
      }
    } catch (error) {
      this.stop = 'failed';
      if (!this.attempted) this.failure = error;
      this.deps.logger.warn(
        `Meta inbox event ${this.turn.job.id}: a message was not sent (${errorClass(error)})`,
      );
    } finally {
      this.lastSendAt = this.deps.pacing.now();
    }
    return { delivered: this.delivered };
  }

  private async stopForNewer(): Promise<boolean> {
    if (!(await this.newerStops())) return false;
    this.stop = 'newer';
    return true;
  }

  /**
   * The final answer (key `<key>`, `:t2`…; pictures `<key>:img` when `withImages`) after the
   * agent's own sends. Throws like today when the first commit of the turn fails. Resolves whether
   * any of it was committed (false: the final was dropped).
   */
  async sendFinal(
    text: string,
    images: readonly { url: string }[],
    withImages: boolean,
  ): Promise<boolean> {
    if (this.stop) return false;
    if (this.sends) await this.pace();
    this.sends++;
    const before = this.lastId;
    try {
      if (text.trim()) await this.sendText(text, this.turn.key);
      if (!this.stop && withImages && images.length && !(await this.newerStops()))
        await this.sendImages(images, `${this.turn.key}:img`);
    } finally {
      this.lastSendAt = this.deps.pacing.now();
    }
    return this.lastId !== before;
  }

  private committed(result: InboxMessageDto): void {
    this.first ??= result;
    this.lastId = result.id;
    this.statuses.add(result.status);
  }

  /**
   * Billed once per delivered answer, on its first sent message (a failed album whose single
   * pictures went out still counts). Nothing committed, or only failures: the reservation is
   * released. A delivery that is still unsure keeps it until the TTL, then it stops counting.
   */
  get billing(): 'capture' | 'release' | 'hold' {
    if (this.statuses.has('sent')) return 'capture';
    return [...this.statuses].every((s) => s === 'failed') ? 'release' : 'hold';
  }

  private async newerStops(): Promise<boolean> {
    return this.watchNewer && (await this.hasNewerMessage());
  }

  private async pace(): Promise<void> {
    if (this.lastSendAt === null) return;
    const wait = this.lastSendAt + SEND_GAP_MS - this.deps.pacing.now();
    if (wait > 0) await this.deps.pacing.sleep(wait);
  }

  /**
   * Bubbles of one text (`splitReply`); stops at the first one not delivered. Quick replies go on
   * the last bubble only (spec §4.4); keys and pacing do not change.
   */
  private async sendText(
    text: string,
    key: string,
    quickReplies?: readonly QuickReply[],
  ): Promise<void> {
    const { job, conversationId, revision } = this.turn;
    const { inbox, channels } = this.deps;
    const bubbles = splitReply(text.slice(0, MAX_TEXT_CHARS));
    for (const [index, bubble] of bubbles.entries()) {
      if (index > 0) {
        // The customer wrote again: the rest of this message would be out of date.
        if (await this.stopForNewer()) break;
        void channels
          .presence(job.workspaceId, job.connectionId, job.event.senderExternalId, 'typing_on')
          .catch(() => undefined);
      }
      const idempotencyKey = index === 0 ? key : `${key}:t${index + 1}`;
      const buttons =
        index === bubbles.length - 1 && quickReplies?.length
          ? { quickReplies: quickReplies.slice(0, 3) }
          : {};
      // The turn's first message also checks that nothing changed since the context was read;
      // later ones only need the bot to still hold the conversation.
      const result = this.first
        ? await inbox.commitBotFollowUp(job.workspaceId, conversationId, {
            text: bubble,
            idempotencyKey,
            ...buttons,
          })
        : await inbox.commitBotReply(job.workspaceId, conversationId, {
            revision,
            text: bubble,
            idempotencyKey,
            ...buttons,
          });
      if (!result) {
        this.stop = 'takeover';
        break;
      }
      this.committed(result);
      if (result.status !== 'sent') {
        this.stop = 'failed';
        this.deps.logger.warn(
          `Meta inbox event ${job.id}: a bubble was not delivered (${result.status}), the answer is incomplete`,
        );
        break;
      }
      this.delivered++;
    }
  }

  /**
   * Pictures as one album, or one message per picture when Meta rejects the album (the adapter
   * already retried it once on 2018047). Best effort: a failure is recorded on the message and
   * never stops the turn; a takeover does. Counts delivered messages in `delivered`.
   */
  private async sendImages(images: readonly { url: string }[], key: string): Promise<void> {
    const { job, conversationId } = this.turn;
    const urls = [...new Set(images.map((i) => i.url))].slice(0, MAX_BOT_IMAGES);
    if (!urls.length) return;
    const commit = async (list: readonly string[], idempotencyKey: string) => {
      const result = await this.deps.inbox.commitBotImages(job.workspaceId, conversationId, {
        urls: list,
        idempotencyKey,
      });
      if (result) {
        this.committed(result);
        if (result.status === 'sent') this.delivered++;
      } else {
        this.stop = 'takeover';
        this.deps.logger.log(
          `Meta inbox event ${job.id}: images skipped, the bot no longer holds the conversation`,
        );
      }
      return result;
    };
    try {
      const album = await commit(urls, key);
      if (!album || album.status !== 'failed' || urls.length === 1) return;
    } catch (error) {
      this.deps.logger.warn(`Meta inbox event ${job.id}: images not sent (${errorClass(error)})`);
      return;
    }
    for (const [index, url] of urls.entries()) {
      try {
        if (!(await commit([url], `${key}:${index}`))) break;
      } catch (error) {
        this.deps.logger.warn(
          `Meta inbox event ${job.id}: image ${index + 1} not sent (${errorClass(error)})`,
        );
      }
    }
  }
}

/** Rule 07: the error class (or code) only, never the message, which may carry customer data. */
export function errorClass(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return 'unknown';
}

/** The answer still to send after the run: the `final` message, or (older replies) `reply` + `images`. */
export function finalMessage(response: ReplyResult): {
  text: string;
  images: readonly { url: string }[];
} {
  if (!response.messages) return { text: response.reply, images: response.images ?? [] };
  const final = response.messages.find((m) => m.via === 'final');
  return { text: final?.text ?? '', images: final?.images ?? [] };
}

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** The bot's fallback message (same default wording as the ai module) when a turn sent nothing. */
export function fallbackText(bot: BotView): string {
  return (
    bot.fallbackMessage?.trim() ||
    (bot.language === 'en'
      ? "I don't have that information yet. Please tell us more or leave a phone number so our staff can help."
      : `Dạ, ${bot.selfPronoun} chưa có thông tin này ạ. ${cap(bot.customerPronoun)} nhắn rõ hơn hoặc để lại số điện thoại để nhân viên hỗ trợ giúp mình nhé.`)
  );
}

export function handoffText(bot: BotView): string {
  return (
    bot.handoffMessage.trim() ||
    (bot.language === 'en'
      ? "I've passed your conversation to our staff. They'll reply shortly."
      : `Dạ, ${bot.selfPronoun} đã chuyển cho nhân viên hỗ trợ, ${bot.customerPronoun} đợi một chút ạ.`)
  );
}

/** "Seen", then "typing…" until the answer is out: the customer sees the bot at work at once. */
export function showTyping(channels: ChannelFacade, job: PendingMetaEvent): () => void {
  const { workspaceId: ws, connectionId } = job;
  const to = job.event.senderExternalId;
  let stopped = false;
  const typing = () =>
    stopped ? Promise.resolve() : channels.presence(ws, connectionId, to, 'typing_on');
  void channels
    .presence(ws, connectionId, to, 'mark_seen')
    .then(typing)
    .catch(() => undefined);
  const timer = setInterval(() => void typing().catch(() => undefined), TYPING_REFRESH_MS);
  return () => {
    // A slow "seen" must not be followed by a "typing…" after the answer is already out.
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * The newest image attachments of the pending customer turn (max 3), downloaded for the model;
 * none when vision is off (`fetcher` null). Never throws: any failure leaves the image out and the
 * turn degrades to the text-only note.
 */
export async function fetchTurnImages(
  fetcher: ImageFetcher | null,
  pending: readonly {
    direction: string;
    attachments: readonly { type: string; url: string }[];
  }[],
): Promise<{ images: ImageInput[]; seen: Set<string> }> {
  const result = { images: [] as ImageInput[], seen: new Set<string>() };
  if (!fetcher) return result;
  const urls = pending
    .filter((m) => m.direction === 'inbound')
    .flatMap((m) => m.attachments.filter((a) => a.type === 'image').map((a) => a.url))
    .reverse()
    .slice(0, MAX_VISION_IMAGES);
  const downloads = await Promise.all(urls.map((url) => fetcher.fetch(url).catch(() => null)));
  let total = 0;
  downloads.forEach((image, i) => {
    const url = urls[i];
    const size = image ? Math.floor((image.base64.length * 3) / 4) : 0;
    if (!image || !url || total + size > 6_000_000) return;
    total += size;
    result.images.push(image);
    result.seen.add(url);
  });
  return result;
}
