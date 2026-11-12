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

/** A hold the bot placed earlier in the conversation (`lodging.holds_before`). */
export interface EvalHeldBefore {
  hold: string;
  code: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  guestPhone: string;
  totalSell: number | null;
}

export interface EvalLodgingFixture {
  taken: EvalTakenStay[];
  holds_before?: EvalHeldBefore[] | undefined;
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
 * `LodgingBotHolds` contract (whole-property options only, weekday rates, whole-property bedroom
 * packages, extra-adult surcharges,
 * problem codes, a summary in the layout of `buildHoldSummary`, one draft per case) but none of its
 * storage, locking, date or review rules; those have their own tests in the lodging module.
 */
export function evalLodging(
  products: readonly ProductDto[],
  fixture: EvalLodgingFixture = { taken: [], hold_minutes: 120, taken_before_confirm: false },
): LodgingBotFacade {
  const properties = products.filter((p) => p.accommodation);
  // Earlier holds of the conversation: live (status hold) and taking their nights.
  const earlier = (fixture.holds_before ?? []).map((h) => ({ ...h, status: 'hold' }));
  const taken: (EvalTakenStay & { hold?: string })[] = [
    ...fixture.taken,
    ...earlier.map((h) => ({
      code: h.code,
      checkIn: h.checkIn,
      checkOut: h.checkOut,
      hold: h.hold,
    })),
  ];
  let draft: {
    propertyId: string;
    stay: Stay;
    storedAt: Date;
    phone?: string;
    earlierHolds?: string[];
  } | null = null;
  let holds = Math.max(0, ...earlier.map((h) => Number(h.hold.slice(3))));
  const digits = (phone: string) => phone.replace(/\D/g, '').slice(-9);
  /** As the real facade: the live earlier hold for the same property and guest phone. */
  const replacedOf = (codes: readonly string[] | undefined, propertyCode: string, phone: string) =>
    earlier.find(
      (h) =>
        h.status === 'hold' &&
        (codes ?? []).includes(h.hold) &&
        h.code.toLowerCase() === propertyCode.toLowerCase() &&
        digits(h.guestPhone) === digits(phone),
    );

  const isFree = (p: ProductDto, stay: Stay, ignoreHold?: string): boolean => {
    const nights = new Set(nightsOf(stay.checkIn, stay.checkOut));
    return !taken.some(
      (t) =>
        (ignoreHold === undefined || t.hold !== ignoreHold) &&
        t.code.toLowerCase() === p.code.toLowerCase() &&
        nightsOf(t.checkIn, t.checkOut).some((n) => nights.has(n)),
    );
  };

  const overMax = (p: ProductDto, stay: Stay): boolean => {
    const max = p.accommodation?.maxGuests;
    return typeof max === 'number' && stay.adults + stay.childAges.length > max;
  };

  type Pkg = NonNullable<NonNullable<ProductDto['accommodation']>['packages']>[number];

  /**
   * The whole-property package a quote uses (T-193, as `quoteStay`): the one asked for, else the
   * fewest bedrooms that holds the party and is sold every night, else the full package.
   */
  const packageFor = (p: ProductDto, stay: Stay, name?: string): Pkg | undefined => {
    const pkgs = [...(p.accommodation?.packages ?? [])].sort((a, b) => a.bedrooms - b.bedrooms);
    if (!pkgs.length) return undefined;
    if (name) return pkgs.find((k) => k.name.trim().toLowerCase() === name.trim().toLowerCase());
    const party = stay.adults + stay.childAges.length;
    const sold = (k: Pkg) =>
      nightsOf(stay.checkIn, stay.checkOut).every((d) => k.weekdaySell[isoWeekday(d) - 1] !== null);
    const fit = pkgs.find(
      (k) => (k.maxGuests ?? k.standardAdults + k.standardChildren) >= party && sold(k),
    );
    return fit ?? pkgs.at(-1);
  };

  const quoteOf = (p: ProductDto, stay: Stay, pkg?: Pkg) => {
    const acc = p.accommodation;
    if (!acc) throw new Error(`eval product ${p.code} has no accommodation`);
    const sellOn = (date: string): number | undefined =>
      pkg
        ? (pkg.weekdaySell[isoWeekday(date) - 1] ?? undefined)
        : acc.rates.find((r) => r.days.includes(isoWeekday(date)))?.amount;
    const nightly = nightsOf(stay.checkIn, stay.checkOut).flatMap((date) => {
      const sell = sellOn(date);
      const label = WEEKDAYS[isoWeekday(date)] ?? '';
      return sell === undefined ? [] : [{ date, weekdayLabel: label, label, sell }];
    });
    const nights = nightsOf(stay.checkIn, stay.checkOut).length;
    const standardAdults = pkg?.standardAdults ?? acc.standardAdults;
    const standardChildren = pkg?.standardChildren ?? acc.standardChildren;
    const extraAdults = Math.max(0, stay.adults - standardAdults);
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
      (extraAdults > 0 && extraAdult === null) || stay.childAges.length > standardChildren;
    const overPackage =
      pkg !== undefined &&
      pkg.maxGuests !== null &&
      stay.adults + stay.childAges.length > pkg.maxGuests;
    const complete = nightly.length === nights;
    return {
      nightly,
      surcharges,
      overStandard,
      fits: !overStandard && !overMax(p, stay) && !overPackage,
      totalSell: complete
        ? nightly.reduce((s, n) => s + n.sell, 0) + surcharges.reduce((s, x) => s + x.sell, 0)
        : null,
    };
  };

  const optionOf = (p: ProductDto, stay: Stay, name?: string): BotAvailabilityOption => {
    const pkg = packageFor(p, stay, name);
    const q = quoteOf(p, stay, pkg);
    const others = (p.accommodation?.packages ?? [])
      .filter((k) => pkg && k.name !== pkg.name)
      .sort((a, b) => a.bedrooms - b.bedrooms);
    return {
      propertyId: p.id,
      code: p.code,
      name: p.name,
      whole: true,
      unitIds: [],
      unitNames: [],
      fits: q.fits,
      overStandard: q.overStandard,
      minNights: null,
      problems: [],
      totalSell: q.totalSell,
      package: pkg?.name ?? null,
      alternatives: others.map((k) => {
        const alt = quoteOf(p, stay, k);
        return { package: k.name, bedrooms: k.bedrooms, totalSell: alt.totalSell, fits: alt.fits };
      }),
      nightly: q.nightly,
      surcharges: q.surcharges,
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

  const summaryOf = (
    p: ProductDto,
    stay: Stay,
    name: string,
    phone: string,
    packageName?: string,
    replaces?: string,
  ): string => {
    const option = optionOf(p, stay, packageName);
    const kids = stay.childAges.length
      ? `, ${stay.childAges.length} trẻ em (${stay.childAges.join(', ')} tuổi)`
      : '';
    const h = Math.floor(fixture.hold_minutes / 60);
    const m = fixture.hold_minutes % 60;
    return [
      `Giữ chỗ ${p.name}${option.package ? ` · Nguyên căn · gói ${option.package}` : ''}`,
      `${day(stay.checkIn)} → ${day(stay.checkOut)} · ${option.nightly.length} đêm`,
      `${stay.adults} người lớn${kids}`,
      `Tổng: ${formatVnd(option.totalSell ?? 0)}`,
      `Tên: ${name} · SĐT: ${phone}`,
      ...(replaces ? [`Thay cho giữ chỗ ${replaces} (huỷ khi giữ chỗ này)`] : []),
      `Giữ trong ${[h ? `${h} giờ` : '', m ? `${m} phút` : ''].filter(Boolean).join(' ')}, nhân viên sẽ gọi xác nhận.`,
    ].join('\n');
  };

  if (fixture.hold_draft) {
    const seed = fixture.hold_draft;
    const p = properties.find((x) => x.code.toLowerCase() === seed.code.toLowerCase());
    if (!p) throw new Error(`lodging.hold_draft: no property with code ${seed.code}`);
    draft = { propertyId: p.id, stay: seed, storedAt: new Date(0), phone: seed.guestPhone };
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
      const replaced = p ? replacedOf(input.earlierHolds, p.code, input.guestPhone) : undefined;
      if (!p) problems.push('not_sold');
      else if (!problems.length) {
        if (!isFree(p, stay, replaced?.hold)) problems.push('not_available');
        else if (overMax(p, stay)) problems.push('over_max');
      }
      const asked = input.packages?.find((k) => k.unitId === null)?.name;
      if (!problems.length && p && asked && !packageFor(p, stay, asked)) {
        return {
          status: 'problems' as const,
          problems: ['unknown_package' as const],
          alternatives: [],
          validPackages: (p.accommodation?.packages ?? []).map((k) => k.name),
        };
      }
      if (problems.length || !p)
        return {
          status: 'problems' as const,
          problems,
          alternatives: problems.some((x) => ['not_available', 'not_sold', 'over_max'].includes(x))
            ? ranked(stay, input.propertyId)
            : [],
        };
      draft = {
        propertyId: p.id,
        stay,
        storedAt: new Date(),
        phone: input.guestPhone,
        ...(input.earlierHolds ? { earlierHolds: input.earlierHolds } : {}),
      };
      return {
        status: 'ready' as const,
        summary: summaryOf(
          p,
          stay,
          input.guestName.trim(),
          input.guestPhone.trim(),
          asked,
          replaced?.hold,
        ),
        holdMinutes: fixture.hold_minutes,
        ...(replaced ? { replaces: replaced.hold } : {}),
      };
    },
    confirmBotHold: async (_ws, input) => {
      if (!draft) return { status: 'no_draft' as const, alternatives: [] };
      const held = draft;
      draft = null;
      const p = properties.find((x) => x.id === held.propertyId);
      if (!p) return { status: 'no_draft' as const, alternatives: [] };
      if (fixture.taken_before_confirm) taken.push({ code: p.code, ...held.stay });
      const replaced = replacedOf(input.earlierHolds, p.code, held.phone ?? '');
      if (!isFree(p, held.stay, replaced?.hold))
        return { status: 'not_available' as const, alternatives: ranked(held.stay, p.id) };
      if (replaced) {
        replaced.status = 'cancelled';
        taken.splice(
          taken.findIndex((t) => t.hold === replaced.hold),
          1,
        );
      }
      taken.push({ code: p.code, ...held.stay });
      holds += 1;
      return {
        status: 'held' as const,
        code: `BK-${String(holds).padStart(4, '0')}`,
        holdExpiresAt: new Date(Date.now() + fixture.hold_minutes * 60_000).toISOString(),
        ...(replaced ? { replaced: replaced.hold } : {}),
      };
    },
    botConversationHolds: async (_ws, input) =>
      earlier
        .filter((h) => input.codes.includes(h.hold))
        .map((h) => {
          const p = properties.find((x) => x.code.toLowerCase() === h.code.toLowerCase());
          return {
            code: h.hold,
            propertyCode: h.code,
            propertyName: p?.name ?? h.code,
            checkIn: h.checkIn,
            checkOut: h.checkOut,
            adults: h.adults,
            childAges: h.childAges,
            totalSell: h.totalSell,
            status: h.status,
            holdExpiresAt:
              h.status === 'hold'
                ? new Date(Date.now() + fixture.hold_minutes * 60_000).toISOString()
                : null,
          };
        }),
    cancelBotHoldDraft: async () => {
      draft = null;
    },
    hasBotHoldDraft: async () => ({ pending: draft !== null, storedAt: draft?.storedAt ?? null }),
  };
}
