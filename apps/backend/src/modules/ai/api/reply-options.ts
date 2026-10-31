import type { ChatMessage } from '@agent-sales/ai-core';
import type { PlaygroundResponse } from '@agent-sales/contracts';

export interface OutgoingMessage {
  text?: string;
  images: { id: string; url: string; label: string }[];
}

/** Where `send_message` output goes: a channel delivery or, in the playground, a collector. */
export interface MessageSink {
  send(message: OutgoingMessage): Promise<{ delivered: number }>;
}

export interface ReplyOptions {
  conversationId: string | null;
  isTest: boolean;
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

/** What AiFacade.reply returns: the public DTO plus, on interrupt, the loop's follow-up messages to carry into the re-run. */
export type ReplyResult = PlaygroundResponse & { carry?: ChatMessage[] };
