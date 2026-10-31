import type { ToolDefinition } from '@agent-sales/ai-core';
import { z } from 'zod';

import type { MessageSink, OutgoingMessage, QuickReply } from '../api/reply-options.js';
import type { AllowedImage } from '../domain/image-allowlist.js';
import { normalizeReplyText } from '../domain/reply-text.js';
import { safeJson } from './action-tools.js';
import type { RunnableTool } from './tool-runner.js';

export const SEND_MESSAGE_TOOL = 'send_message';
export const HANDOFF_TOOL = 'handoff';
export const MAX_SEND_TEXT_CHARS = 2_000;
export const MAX_SEND_IMAGES = 3;

const SendMessageInput = z
  .object({
    text: z.string().max(MAX_SEND_TEXT_CHARS).optional(),
    imageIds: z.array(z.string().max(200)).max(MAX_SEND_IMAGES).optional(),
  })
  .refine((v) => Boolean(v.text?.trim()) || Boolean(v.imageIds?.length), {
    message: 'give text or imageIds',
  });

const HandoffInput = z.object({ reason: z.string().trim().min(1).max(500) });

/** One message the bot sent during the turn, in order. */
export interface SentMessage {
  text: string;
  images: { id: string; url: string; label: string }[];
  /** Buttons under the message (the order summary's confirm / edit). */
  quickReplies?: QuickReply[];
  via: 'send_message' | 'final';
}

/** What the output tools did this turn, read by the reply pipeline after the loop. */
export interface OutputState {
  sent: SentMessage[];
  /** The handoff tool ran: its reason (kept server-side, never logged). */
  handoff: string | null;
}

export const newOutputState = (): OutputState => ({ sent: [], handoff: null });

/**
 * The pictures the bot may send this turn: focus products, image-library matches and every product
 * whose details a tool returned so far. Grows while the loop runs; the model only ever sees ids.
 */
export class ImageAllowlist {
  readonly #byId = new Map<string, AllowedImage>();

  constructor(initial: readonly AllowedImage[] = []) {
    this.add(initial);
  }

  add(images: readonly AllowedImage[]): void {
    for (const image of images) if (!this.#byId.has(image.id)) this.#byId.set(image.id, image);
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
    'Sends one chat message to the customer right away, while you keep working: optional text (max 2000 characters) and up to 3 picture ids (from product "images" or the "Images you may send" list). Call it several times for more pictures. Do not repeat its text in your answer.',
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
}): { definitions: ToolDefinition[]; runnable: RunnableTool[] } {
  const { sink, allowlist, state } = opts;

  const sendMessage: RunnableTool = {
    name: SEND_MESSAGE_TOOL,
    readOnly: false,
    schema: SendMessageInput,
    run: async (input) => {
      const args = input as z.infer<typeof SendMessageInput>;
      const text = normalizeReplyText(args.text ?? '');
      const { images, dropped } = allowlist.resolve(args.imageIds ?? []);
      const extra = dropped.length ? { droppedImageIds: dropped } : {};
      if (!text && !images.length)
        return { content: safeJson({ error: 'nothing_to_send', ...extra }), ok: false };
      const message: OutgoingMessage = {
        ...(text ? { text } : {}),
        images: images.map(({ id, url, label }) => ({ id, url, label })),
      };
      const delivered = sink ? (await sink.send(message)).delivered : 1;
      if (delivered <= 0)
        return { content: safeJson({ error: 'not_delivered', ...extra }), ok: false };
      state.sent.push({ text, images: message.images, via: 'send_message' });
      return { content: safeJson({ status: 'sent', delivered, ...extra }) };
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
