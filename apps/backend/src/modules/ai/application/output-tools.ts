import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import type { MessageSuggestion, MessageUi, ProductDto } from '@agent-sales/contracts';
import { z } from 'zod';

import { absoluteMediaUrl, mediaPath } from '../../../common/storage/media-url.js';
import type { MessageSink, OutgoingMessage, QuickReply } from '../api/reply-options.js';
import {
  type AllowedAlbum,
  type AllowedImage,
  type AllowedVideo,
  nextAlbumPage,
  productAlbums,
  productImages,
  productVideos,
} from '../domain/image-allowlist.js';
import { normalizeReplyText } from '../domain/reply-text.js';
import { safeJson } from './action-tools.js';

export const SEND_MESSAGE_TOOL = 'send_message';
export const HANDOFF_TOOL = 'handoff';
export const MAX_SEND_TEXT_CHARS = 2_000;
export const MAX_SEND_IMAGES = 3;

const SendMessageInput = z
  .object({
    text: z.string().max(MAX_SEND_TEXT_CHARS).optional(),
    imageIds: z.array(z.string().max(200)).max(MAX_SEND_IMAGES).optional(),
    albumId: z.string().max(200).optional(),
    videoId: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.text?.trim()) ||
      Boolean(v.imageIds?.length) ||
      Boolean(v.albumId?.trim()) ||
      Boolean(v.videoId?.trim()),
    { message: 'give text, imageIds, albumId or videoId' },
  )
  .refine((v) => !(v.albumId?.trim() && v.imageIds?.length), {
    message: 'give albumId or imageIds, not both',
    path: ['albumId'],
  });

const HandoffInput = z.object({ reason: z.string().trim().min(1).max(500) });

/** One message the bot sent during the turn, in order. */
export interface SentMessage {
  text: string;
  images: { id: string; url: string; label: string }[];
  /** An uploaded video sent as its own message (T-192). */
  videos?: { id: string; url: string; label: string }[];
  /** Buttons under the message (the order summary's confirm / edit). */
  quickReplies?: QuickReply[];
  /** Website only: product cards, or the suggested next steps of the final message (ADR-029). */
  ui?: MessageUi;
  via: 'send_message' | 'final';
}

/** What the output tools did this turn, read by the reply pipeline after the loop. */
export interface OutputState {
  sent: SentMessage[];
  /** The handoff tool ran: its reason (kept server-side, never logged). */
  handoff: string | null;
  /** `suggest_next` ran: buttons for the final message (website only). */
  suggestions?: MessageSuggestion[] | null;
}

export const newOutputState = (): OutputState => ({ sent: [], handoff: null, suggestions: null });

/**
 * The pictures the bot may send this turn: focus products, image-library matches and every product
 * whose details a tool returned so far. Grows while the loop runs; the model only ever sees ids.
 */
export class ImageAllowlist {
  readonly #byId = new Map<string, AllowedImage>();
  readonly #albums = new Map<string, AllowedAlbum>();
  readonly #videos = new Map<string, AllowedVideo>();

  /**
   * `mediaBase` is the current public base of Rapiz storage (`S3_PUBLIC_URL`): stored pictures are
   * host-relative `/media/…` paths (or URLs on a former host), so each is rebuilt on it here, at
   * send time. A picture that still is not an https URL (no base configured) cannot be sent.
   */
  constructor(
    initial: readonly AllowedImage[] = [],
    private readonly mediaBase?: string,
  ) {
    this.add(initial);
  }

  add(images: readonly AllowedImage[]): void {
    for (const image of images) {
      if (this.#byId.has(image.id)) continue;
      const url = absoluteMediaUrl(image.url, this.mediaBase);
      if (url.startsWith('https://')) this.#byId.set(image.id, { ...image, url });
    }
  }

  /** Pictures, folders and videos of products whose details the model received. */
  addProducts(products: readonly ProductDto[]): void {
    this.add(productImages(products));
    this.addMedia(products);
  }

  /** Folders and videos only (focus products: their pictures are already ranked into the list). */
  addMedia(products: readonly ProductDto[]): void {
    for (const album of productAlbums(products)) {
      if (this.#albums.has(album.id)) continue;
      const images = album.images
        .map((image) => ({ ...image, url: absoluteMediaUrl(image.url, this.mediaBase) }))
        .filter((image) => image.url.startsWith('https://'));
      if (images.length) this.#albums.set(album.id, { ...album, images });
    }
    for (const video of productVideos(products)) {
      if (this.#videos.has(video.id)) continue;
      const url = video.kind === 'video' ? absoluteMediaUrl(video.url, this.mediaBase) : video.url;
      if (url.startsWith('https://')) this.#videos.set(video.id, { ...video, url });
    }
  }

  /**
   * The public https URL of a stored picture without allowing it to be sent: a product card's
   * picture comes from the catalog, not from an id the model chose.
   */
  publicUrl(url: string): string | null {
    const absolute = absoluteMediaUrl(url, this.mediaBase);
    return absolute.startsWith('https://') ? absolute : null;
  }

  album(id: string): AllowedAlbum | undefined {
    return this.#albums.get(id.trim());
  }

  video(id: string): AllowedVideo | undefined {
    return this.#videos.get(id.trim());
  }

  /** Resolves ids in the order given, deduplicated; ids outside the allowlist are returned as `dropped`. */
  resolve(ids: readonly string[]): { images: AllowedImage[]; dropped: string[] } {
    const images: AllowedImage[] = [];
    const dropped: string[] = [];
    const seen = new Set<string>();
    for (const raw of ids) {
      const id = raw.trim();
      const image = this.#byId.get(id);
      if (!image) {
        dropped.push(id.slice(0, 80));
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      images.push(image);
    }
    return { images, dropped };
  }
}

const SEND_MESSAGE_DEFINITION: ToolDefinition = {
  name: SEND_MESSAGE_TOOL,
  description:
    'Sends one chat message to the customer right away, while you keep working: optional text (max 2000 characters) and either up to 3 picture ids (from product "images" or the "Images you may send" list) or one albumId (from product "albums": sends the next 8 photos of that folder the customer has not received yet; the result says how many remain), plus at most one videoId (from product "videos"). Call it several times for more. Do not repeat its text in your answer.',
  input: SendMessageInput,
};

const HANDOFF_DEFINITION: ToolDefinition = {
  name: HANDOFF_TOOL,
  description:
    'Hands the conversation over to the shop staff: when the customer asks for a person or a staff decision is needed. The shop then sends its own hand-over message.',
  input: HandoffInput,
};

/**
 * `send_message` (omitted for public comment replies) and `handoff`. Messages go to `sink` when the
 * caller gave one (a channel delivery), otherwise they are collected (playground). Either way they
 * are recorded in `state.sent`.
 */
export function outputTools(opts: {
  sink?: MessageSink;
  allowlist: ImageAllowlist;
  state: OutputState;
  sendMessage: boolean;
  sentMediaUrls?: readonly string[];
}): { definitions: ToolDefinition[]; runnable: RunnableTool[] } {
  const { sink, allowlist, state } = opts;

  // Album paging (spec D3): a photo the conversation already received (any host) or that went
  // out earlier in this turn counts as sent. Once a folder restarts in this turn, only what went out
  // since the restart counts (`restartAt`: index into `state.sent`), so later calls page on.
  const sentKey = (url: string): string => mediaPath(url) ?? url;
  const earlier = new Set((opts.sentMediaUrls ?? []).map(sentKey));
  const restartAt = new Map<string, number>();
  const sentIn = (from: number, url: string): boolean =>
    state.sent
      .slice(from)
      .some((m) => m.images.some((image) => sentKey(image.url) === sentKey(url)));
  const wasSent = (albumId: string, url: string): boolean => {
    const from = restartAt.get(albumId);
    return from === undefined ? earlier.has(sentKey(url)) || sentIn(0, url) : sentIn(from, url);
  };

  const sendMessage: RunnableTool = {
    name: SEND_MESSAGE_TOOL,
    readOnly: false,
    schema: SendMessageInput,
    run: async (input) => {
      const args = input as z.infer<typeof SendMessageInput>;
      const albumId = args.albumId?.trim() ?? '';
      const videoId = args.videoId?.trim() ?? '';
      const { images: picked, dropped } = allowlist.resolve(args.imageIds ?? []);
      const album = albumId ? allowlist.album(albumId) : undefined;
      const video = videoId ? allowlist.video(videoId) : undefined;
      if (albumId && !album) dropped.push(albumId.slice(0, 80));
      if (videoId && !video) dropped.push(videoId.slice(0, 80));
      const page = album
        ? nextAlbumPage(album.images.map((image) => wasSent(album.id, image.url)))
        : null;
      const images =
        album && page
          ? page.indexes.flatMap((k) => {
              const image = album.images[k];
              return image ? [{ id: `${album.id}:${k}`, url: image.url, label: image.label }] : [];
            })
          : picked.map(({ id, url, label }) => ({ id, url, label }));
      // A link is text the customer opens; an uploaded video goes out as its own message.
      const link = video?.kind === 'link' ? `${video.title}: ${video.url}` : '';
      const text = [normalizeReplyText(args.text ?? ''), link].filter(Boolean).join('\n');
      const videos =
        video?.kind === 'video' ? [{ id: video.id, url: video.url, label: video.label }] : [];
      const extra = dropped.length ? { droppedImageIds: dropped } : {};
      if (!text && !images.length && !videos.length)
        return { content: safeJson({ error: 'nothing_to_send', ...extra }), ok: false };
      const message: OutgoingMessage = {
        ...(text ? { text } : {}),
        images,
        ...(videos.length ? { videos } : {}),
      };
      const outcome: { delivered: number; complete?: boolean } = sink
        ? await sink.send(message)
        : { delivered: 1 };
      const delivered = outcome.delivered;
      if (delivered <= 0)
        return { content: safeJson({ error: 'not_delivered', ...extra }), ok: false };
      // The 30-day set is unordered, so a later turn cannot tell where a re-sent cycle stopped:
      // the first restart of a folder in this turn reports nothing remaining (the bot must not
      // promise photos it cannot page to). Within this turn further calls page on from the restart.
      const firstRestart = Boolean(album && page?.restarted && !restartAt.has(album.id));
      if (album && page?.restarted) restartAt.set(album.id, state.sent.length);
      state.sent.push({ text, images, ...(videos.length ? { videos } : {}), via: 'send_message' });
      const albumResult = page
        ? {
            album: {
              sent: images.length,
              remaining: firstRestart ? 0 : page.remaining,
              ...(page.restarted ? { restarted: true } : {}),
            },
          }
        : {};
      return {
        content: safeJson({
          status: 'sent',
          delivered,
          ...albumResult,
          ...(video ? { video: video.kind } : {}),
          // Part of it did not go out (e.g. Meta rejected the video): kept in the turn trace.
          ...(outcome.complete === false ? { incomplete: true } : {}),
          ...extra,
        }),
      };
    },
  };

  const handoff: RunnableTool = {
    name: HANDOFF_TOOL,
    readOnly: false,
    schema: HandoffInput,
    run: async (input) => {
      state.handoff = (input as z.infer<typeof HandoffInput>).reason;
      return { content: safeJson({ status: 'handed_over' }) };
    },
  };

  return opts.sendMessage
    ? {
        definitions: [SEND_MESSAGE_DEFINITION, HANDOFF_DEFINITION],
        runnable: [sendMessage, handoff],
      }
    : { definitions: [HANDOFF_DEFINITION], runnable: [handoff] };
}
