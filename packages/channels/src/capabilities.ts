import type { ChannelCapabilities, ChannelKind } from './adapter.js';
import { WEBSITE_CAPABILITIES } from './website.js';

export const META_CAPABILITIES: ChannelCapabilities = {
  richCards: false,
  quickReplies: true,
  media: true,
  replyWindowHours: 24,
};

/** Capabilities by provider/kind. Unknown kinds get the strictest window (24 h). */
export function capabilitiesOf(kind: ChannelKind | string): ChannelCapabilities {
  return kind === 'website' ? WEBSITE_CAPABILITIES : META_CAPABILITIES;
}

/** True when a reply to a customer message received at `lastCustomerAt` is still allowed at `now`. */
export function withinReplyWindow(
  kind: ChannelKind | string,
  lastCustomerAt: Date,
  now: Date = new Date(),
): boolean {
  const hours = capabilitiesOf(kind).replyWindowHours;
  return hours === null || now.getTime() - lastCustomerAt.getTime() < hours * 3_600_000;
}

/** Meta lets a person (never a bot) answer up to 7 days after the customer with `HUMAN_AGENT`. */
export const HUMAN_AGENT_WINDOW_HOURS = 168;

/**
 * Whether a message to a customer whose last message was at `lastCustomerAt` may go out at `now`:
 * `open` inside the channel's window (always on the website), `human_agent` for a member's own
 * reply on Messenger or Instagram between 24 hours and 7 days when the business may use the
 * `HUMAN_AGENT` tag (`humanAgentTag`, env `META_HUMAN_AGENT_TAG`), else `closed`. Bots and the
 * care agent never get `human_agent` (ADR-031): Meta forbids the tag for automated messages.
 */
export function replyWindow(
  kind: ChannelKind | string,
  lastCustomerAt: Date,
  now: Date = new Date(),
  sender: { member: boolean; humanAgentTag: boolean } = { member: false, humanAgentTag: false },
): 'open' | 'human_agent' | 'closed' {
  if (withinReplyWindow(kind, lastCustomerAt, now)) return 'open';
  const meta = kind === 'facebook' || kind === 'instagram';
  if (
    meta &&
    sender.member &&
    sender.humanAgentTag &&
    now.getTime() - lastCustomerAt.getTime() < HUMAN_AGENT_WINDOW_HOURS * 3_600_000
  )
    return 'human_agent';
  return 'closed';
}
