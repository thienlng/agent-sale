/** What a turn reads and shows around its sends: final text, fallbacks, typing, turn images. */
import type { ImageInput } from '@agent-sales/ai-core';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { ReplyResult } from '../../../ai/api/index.js';
import type { BotView } from '../../../bot/api/index.js';
import type { ChannelFacade, PendingMetaEvent } from '../../../channel/api/index.js';
import type { ImageFetcher } from '../ports/image-fetcher.js';

const MAX_VISION_IMAGES = 3;

/** A customer message with something to answer (text or attachments). */
export const isCustomerContent = (e: NormalizedEvent): boolean =>
  e.type === 'message' && Boolean(e.text?.trim() || e.attachments?.length);
/** Meta shows "typing…" for about 20 s; refresh it while the model is still working. */
const TYPING_REFRESH_MS = 10_000;

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
