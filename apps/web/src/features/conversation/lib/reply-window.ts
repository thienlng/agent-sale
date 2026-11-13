import type { ChannelProvider } from '@agent-sales/contracts';

const DAY_MS = 86_400_000;

/**
 * Whether staff may reply now, mirroring `replyWindow` in `packages/channels`: Messenger and
 * Instagram close 24 hours after the customer's last message, and a member may still answer for
 * up to 7 days when the business sends with Meta's HUMAN_AGENT tag (`humanAgentReply`, ADR-031).
 * The website has no window: its visitors can be answered at any time.
 */
export function replyWindowState(
  provider: ChannelProvider,
  lastInboundAt: string,
  now: number,
  humanAgentReply: boolean,
): 'open' | 'human_agent' | 'closed' {
  if (provider === 'website') return 'open';
  const since = now - Date.parse(lastInboundAt);
  if (since < DAY_MS) return 'open';
  if (humanAgentReply && since < 7 * DAY_MS) return 'human_agent';
  return 'closed';
}
