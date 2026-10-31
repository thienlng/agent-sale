import type { ChatMessage } from '@agent-sales/ai-core';
import type { PlaygroundResponse } from '@agent-sales/contracts';

/** A button under a message; tapping it sends `title` as the customer's text. */
export interface QuickReply {
  title: string;
  payload: string;
}

export interface OutgoingMessage {
  text?: string;
  images: { id: string; url: string; label: string }[];
  /** At most 3, titles of 20 characters or fewer; attached to the last bubble only. */
  quickReplies?: QuickReply[];
}

/** Where `send_message` output goes: a channel delivery or, in the playground, a collector. */
export interface MessageSink {
  /**
   * `complete` is false when the message was cut short (a newer message, a takeover or a failure
   * stopped it before every part went out); absent means complete.
   */
  send(message: OutgoingMessage): Promise<{ delivered: number; complete?: boolean }>;
}

export interface ReplyOptions {
  conversationId: string | null;
  isTest: boolean;
  /** The conversation's channel (`facebook`, `instagram`, `website`): the source of a bot order. */
  channel?: string;
  /** Absent: messages are collected (playground). */
  sink?: MessageSink;
  /** Checked by the agent loop between rounds. */
  shouldInterrupt?: () => Promise<boolean>;
  /** Follow-ups of an interrupted turn. */
  carry?: ChatMessage[];
  /**
   * When each entry of `input.messages` was sent (same length and order). Lets the stored
   * conversation summary be reused across turns; without it a long history is summarised per turn.
   */
  turnTimes?: readonly Date[];
}

/**
 * What AiFacade.reply returns: the public DTO plus, on interrupt, the loop's follow-up messages to
 * carry into the re-run, and whether the turn stored an action confirmation question (a caller that
 * drops the answer must then call `discardPendingConfirmation`).
 */
export type ReplyResult = PlaygroundResponse & {
  carry?: ChatMessage[];
  askedConfirmation?: boolean;
  /** The turn created an order: a caller must never drop its final message. */
  orderCreated?: boolean;
};
