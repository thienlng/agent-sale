/**
 * URL search of Lịch (`/app/calendar`): the shown window, filters, expanded rows and the
 * "Tìm trống" search, so leaving for a property's calendar and coming back (link or Back)
 * restores the grid. Every field is optional; invalid values fall back to the defaults.
 */
import type { AvailabilityRequest } from '@agent-sales/contracts';
import { z } from 'zod';

const Uuid = z.uuid();
const csv = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export const CalendarSearchSchema = z.object({
  /** First shown night; absent = today. */
  from: z.iso.date().optional().catch(undefined),
  /** 31 = a month; absent = two weeks. */
  nights: z.literal(31).optional().catch(undefined),
  area: z.coerce.string().max(200).optional().catch(undefined),
  /** Only places with a free night (or that fit the search). */
  free: z.literal(true).optional().catch(undefined),
  /** Expanded rooms properties, comma-separated ids. */
  open: z
    .string()
    .max(4000)
    .refine((v) => csv(v).every((id) => Uuid.safeParse(id).success))
    .optional()
    .catch(undefined),
  /** "Tìm trống": check-in, check-out, adults and children's ages (comma-separated). */
  ci: z.iso.date().optional().catch(undefined),
  co: z.iso.date().optional().catch(undefined),
  adults: z.number().int().min(1).max(100).optional().catch(undefined),
  ages: z.coerce
    .string()
    .max(200)
    .regex(/^\d{1,2}(,\d{1,2})*$/)
    .optional()
    .catch(undefined),
});
export type CalendarSearch = z.infer<typeof CalendarSearchSchema>;

/** The search without empty values, so URLs stay short. */
export function compactCalendarSearch(s: CalendarSearch): CalendarSearch {
  return Object.fromEntries(
    Object.entries(s).filter(([, v]) => v !== undefined && v !== ''),
  ) as CalendarSearch;
}

export function expandedOf(s: CalendarSearch): ReadonlySet<string> {
  return new Set(s.open ? csv(s.open) : []);
}

export function openOf(expanded: ReadonlySet<string>): string | undefined {
  return expanded.size ? [...expanded].join(',') : undefined;
}

/** The "Tìm trống" request in the search, or null. */
export function findOf(s: CalendarSearch): AvailabilityRequest | null {
  if (!s.ci || !s.co || !s.adults) return null;
  return {
    checkIn: s.ci,
    checkOut: s.co,
    party: { adults: s.adults, childAges: s.ages ? csv(s.ages).map(Number) : [] },
  };
}

export function findParams(
  body: AvailabilityRequest | null,
): Pick<CalendarSearch, 'ci' | 'co' | 'adults' | 'ages'> {
  if (!body) return { ci: undefined, co: undefined, adults: undefined, ages: undefined };
  const ages = body.party.childAges ?? [];
  return {
    ci: body.checkIn,
    co: body.checkOut,
    adults: body.party.adults,
    ages: ages.length ? ages.join(',') : undefined,
  };
}

const LAST_KEY = 'rapiz.lodging.calendarSearch';

/**
 * Remembers the last Lịch search for the "← Lịch" link of a property's calendar (this tab
 * only). Storage can be unavailable: then the link opens Lịch on its defaults.
 */
export function rememberCalendarSearch(s: CalendarSearch): void {
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: nothing to remember.
  }
}

export function lastCalendarSearch(): CalendarSearch {
  try {
    const raw = sessionStorage.getItem(LAST_KEY);
    if (!raw) return {};
    const parsed = CalendarSearchSchema.safeParse(JSON.parse(raw));
    return parsed.success ? compactCalendarSearch(parsed.data) : {};
  } catch {
    return {};
  }
}
