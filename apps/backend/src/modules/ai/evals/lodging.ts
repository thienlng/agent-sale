import type { ProductDto } from '@agent-sales/contracts';
import { formatVnd, normalizeVnPhone } from '@agent-sales/shared';

import type {
  BotAvailabilityOption,
  BotAvailabilityResult,
  HoldProblem,
  LodgingBotFacade,
} from '../../lodging/api/index.js';

/** A stay already booked in the case's calendar (case `lodging.taken`). */
export interface EvalTakenStay {
  code: string;
  checkIn: string;
  checkOut: string;
}

/** A hold summary the customer already received before the case's turn (`lodging.hold_draft`). */
export interface EvalHoldDraft {
  code: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  guestName: string;
  guestPhone: string;
}

export interface EvalLodgingFixture {
  taken: EvalTakenStay[];
  hold_minutes: number;
  hold_draft?: EvalHoldDraft | undefined;
  /** Another booking takes the draft's nights between the summary and the customer's answer. */
  taken_before_confirm: boolean;
}

/** The first hold code the fake hands out (`BK-0001`, like the lodging store). */
export const EVAL_FIRST_HOLD_CODE = 'BK-0001';

const WEEKDAYS = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
const SHORT = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const DAY_MS = 86_400_000;
const MAX_NIGHTS = 60;
const MAX_OPTIONS = 5;

const isoWeekday = (date: string): number => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
const nightsOf = (checkIn: string, checkOut: string): string[] => {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return Array.from({ length: Math.round((end - start) / DAY_MS) }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
};
const day = (date: string) =>
  `${date.slice(8, 10)}/${date.slice(5, 7)} (${SHORT[isoWeekday(date)]})`;

interface Stay {
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
}

/**
 * The in-memory lodging bot facade of a case: availability, quotes and holds on the case's
 * accommodation products, deterministic and without a database. It mirrors the real
 * `LodgingBotHolds` contract (whole-property options only, weekday rates, extra-adult surcharges,
 * problem codes, a summary in the layout of `buildHoldSummary`, one draft per case) but none of its
 * storage, locking, date or review rules; those have their own tests in the lodging module.
 */
export function evalLodging(
  products: readonly ProductDto[],
  fixture: EvalLodgingFixture = { taken: [], hold_minutes: 120, taken_before_confirm: false },
): LodgingBotFacade {
  const properties = products.filter((p) => p.accommodation);
  const taken = [...fixture.taken];
  let draft: { propertyId: string; stay: Stay; storedAt: Date } | null = null;
  let holds = 0;

  const isFree = (p: ProductDto, stay: Stay): boolean => {
    const nights = new Set(nightsOf(stay.checkIn, stay.checkOut));
    return !taken.some(
      (t) =>
        t.code.toLowerCase() === p.code.toLowerCase() &&
        nightsOf(t.checkIn, t.checkOut).some((n) => nights.has(n)),
    );
  };

  const overMax = (p: ProductDto, stay: Stay): boolean => {
    const max = p.accommodation?.maxGuests;
    return typeof max === 'number' && stay.adults + stay.childAges.length > max;
  };

  const optionOf = (p: ProductDto, stay: Stay): BotAvailabilityOption => {
    const acc = p.accommodation;
    if (!acc) throw new Error(`eval product ${p.code} has no accommodation`);
    const nightly = nightsOf(stay.checkIn, stay.checkOut).flatMap((date) => {
      const rate = acc.rates.find((r) => r.days.includes(isoWeekday(date)));
      const label = WEEKDAYS[isoWeekday(date)] ?? '';
      return rate ? [{ date, weekdayLabel: label, label, sell: rate.amount }] : [];
    });
    const nights = nightsOf(stay.checkIn, stay.checkOut).length;
    const extraAdults = Math.max(0, stay.adults - acc.standardAdults);
    const extraAdult = acc.surcharges?.extraAdult ?? null;
    const surcharges =
      extraAdults > 0 && extraAdult !== null
        ? [
            {
              kind: 'extra_adult' as const,
              persons: extraAdults,
              nights,
              sell: extraAdult * extraAdults * nights,
            },
          ]
        : [];
    // Guests above the standard that no surcharge covers: staff must check.
    const overStandard =
      (extraAdults > 0 && extraAdult === null) || stay.childAges.length > acc.standardChildren;
    const complete = nightly.length === nights;
    return {
      propertyId: p.id,
      code: p.code,
      name: p.name,
      whole: true,
      unitIds: [],
      unitNames: [],
      fits: !overStandard && !overMax(p, stay),
      overStandard,
      minNights: null,
      problems: [],
      totalSell: complete
        ? nightly.reduce((s, n) => s + n.sell, 0) + surcharges.reduce((s, x) => s + x.sell, 0)
        : null,
      nightly,
      surcharges,
    };
  };

  const ranked = (stay: Stay, except?: string): BotAvailabilityOption[] =>
    properties
      .filter((p) => p.id !== except && isFree(p, stay))
      .map((p) => optionOf(p, stay))
      .sort((a, b) => Number(b.fits) - Number(a.fits) || (a.totalSell ?? 0) - (b.totalSell ?? 0))
      .slice(0, MAX_OPTIONS);

  const stayProblems = (stay: Stay): BotAvailabilityResult['problems'] => {
    const nights = nightsOf(stay.checkIn, stay.checkOut).length;
    if (nights === 0) return ['invalid_dates'];
    return nights > MAX_NIGHTS ? ['too_long'] : [];
  };

  const summaryOf = (p: ProductDto, stay: Stay, name: string, phone: string): string => {
    const option = optionOf(p, stay);
    const kids = stay.childAges.length
      ? `, ${stay.childAges.length} trẻ em (${stay.childAges.join(', ')} tuổi)`
      : '';
    const h = Math.floor(fixture.hold_minutes / 60);
    const m = fixture.hold_minutes % 60;
    return [
      `Giữ chỗ ${p.name}`,
      `${day(stay.checkIn)} → ${day(stay.checkOut)} · ${option.nightly.length} đêm`,
      `${stay.adults} người lớn${kids}`,
      `Tổng: ${formatVnd(option.totalSell ?? 0)}`,
      `Tên: ${name} · SĐT: ${phone}`,
      `Giữ trong ${[h ? `${h} giờ` : '', m ? `${m} phút` : ''].filter(Boolean).join(' ')}, nhân viên sẽ gọi xác nhận.`,
    ].join('\n');
  };

  if (fixture.hold_draft) {
    const seed = fixture.hold_draft;
    const p = properties.find((x) => x.code.toLowerCase() === seed.code.toLowerCase());
    if (!p) throw new Error(`lodging.hold_draft: no property with code ${seed.code}`);
    draft = { propertyId: p.id, stay: seed, storedAt: new Date(0) };
  }

  return {
    checkAvailabilityForBot: async (_ws, input): Promise<BotAvailabilityResult> => {
      const stay = { ...input, childAges: input.childAges };
      const nights = nightsOf(input.checkIn, input.checkOut).length;
      const result = {
        nights,
        checkInWeekdayLabel: WEEKDAYS[isoWeekday(input.checkIn)] ?? '',
        checkOutWeekdayLabel: WEEKDAYS[isoWeekday(input.checkOut)] ?? '',
        requestedFull: false,
        options: [] as BotAvailabilityOption[],
        problems: stayProblems(stay),
      };
      if (result.problems.length) return result;
      const wanted = properties.find((p) => p.id === input.propertyId);
      if (input.propertyId && !wanted)
        return { ...result, options: ranked(stay), problems: ['not_sold'] };
      if (wanted && isFree(wanted, stay)) return { ...result, options: [optionOf(wanted, stay)] };
      if (wanted) return { ...result, requestedFull: true, options: ranked(stay, wanted.id) };
      return { ...result, options: ranked(stay) };
    },
    prepareBotHold: async (_ws, input) => {
      const problems: HoldProblem[] = [];
      if (!input.guestName.trim()) problems.push('missing_name');
      if (!input.guestPhone.trim()) problems.push('missing_phone');
      else if (!normalizeVnPhone(input.guestPhone)) problems.push('invalid_phone');
      const stay = { ...input };
      problems.push(...stayProblems(stay));
      const p = properties.find((x) => x.id === input.propertyId);
      if (!p) problems.push('not_sold');
      else if (!problems.length) {
        if (!isFree(p, stay)) problems.push('not_available');
        else if (overMax(p, stay)) problems.push('over_max');
      }
      if (problems.length || !p)
        return {
          status: 'problems' as const,
          problems,
          alternatives: problems.some((x) => ['not_available', 'not_sold', 'over_max'].includes(x))
            ? ranked(stay, input.propertyId)
            : [],
        };
      draft = { propertyId: p.id, stay, storedAt: new Date() };
      return {
        status: 'ready' as const,
        summary: summaryOf(p, stay, input.guestName.trim(), input.guestPhone.trim()),
        holdMinutes: fixture.hold_minutes,
      };
    },
    confirmBotHold: async () => {
      if (!draft) return { status: 'no_draft' as const, alternatives: [] };
      const held = draft;
      draft = null;
      const p = properties.find((x) => x.id === held.propertyId);
      if (!p) return { status: 'no_draft' as const, alternatives: [] };
      if (fixture.taken_before_confirm) taken.push({ code: p.code, ...held.stay });
      if (!isFree(p, held.stay))
        return { status: 'not_available' as const, alternatives: ranked(held.stay, p.id) };
      taken.push({ code: p.code, ...held.stay });
      holds += 1;
      return {
        status: 'held' as const,
        code: `BK-${String(holds).padStart(4, '0')}`,
        holdExpiresAt: new Date(Date.now() + fixture.hold_minutes * 60_000).toISOString(),
      };
    },
    cancelBotHoldDraft: async () => {
      draft = null;
    },
    hasBotHoldDraft: async () => ({ pending: draft !== null, storedAt: draft?.storedAt ?? null }),
  };
}
