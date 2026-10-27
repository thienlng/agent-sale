import type { ChannelCapabilities, ChannelKind } from './adapter.js';
import { WEBSITE_CAPABILITIES } from './website.js';

export const META_CAPABILITIES: ChannelCapabilities = {
  richCards: false,
  quickReplies: false,
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
