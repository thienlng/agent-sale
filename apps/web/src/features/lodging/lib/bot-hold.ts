import type { BookingDto } from '@agent-sales/contracts';

/**
 * A bot hold no staff member has handled yet ("chờ xử lý", T-161). Mirrors the server's
 * review count: `source = bot`, still on hold, `reviewedAt` unset.
 */
export const botHoldPending = (b: Pick<BookingDto, 'source' | 'status' | 'reviewedAt'>) =>
  b.source === 'bot' && b.status === 'hold' && b.reviewedAt === null;
