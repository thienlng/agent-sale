import type { BookingDto } from '@agent-sales/contracts';

/** The tag of a hold made from the owner's test chat (server `TEST_HOLD_TAG`, VL-A11). */
export const TEST_HOLD_TAG = 'Chat thử';
/** How long a test-chat hold lasts at most (server `TEST_HOLD_MINUTES`). */
export const TEST_HOLD_MINUTES = 15;

/** A hold the owner made in the test chat: it lapses on its own, nobody calls a guest (VL2-9). */
export const isTestHold = (b: Pick<BookingDto, 'tags'>) => b.tags.includes(TEST_HOLD_TAG);

/**
 * A bot hold no staff member has handled yet ("chờ xử lý", T-161). Mirrors the server's
 * review count: `source = bot`, still on hold, `reviewedAt` unset, not a test-chat hold.
 */
export const botHoldPending = (b: Pick<BookingDto, 'source' | 'status' | 'reviewedAt' | 'tags'>) =>
  b.source === 'bot' && b.status === 'hold' && b.reviewedAt === null && !isTestHold(b);
