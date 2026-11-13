import {
  type CustomerRequestKind,
  isRequestIndustry,
  requestDetailsSchema,
  requestProfileFor,
  unmetRules,
} from '@agent-sales/contracts';
import { normalizeAnyPhone, vietnameseDateLabel } from '@agent-sales/shared';

import type { BotRequestResult, CrmFacade } from '../../crm/api/index.js';

const SHOP_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const UPDATE_WINDOW_MS = 24 * 3_600_000;

/**
 * The crm writer's label of a `preferredDate` (the shared helper, so the spelling cannot drift):
 * the Vietnamese weekday, then dd/mm/yyyy.
 */
export const dateLabel = vietnameseDateLabel;

/** Local copy of the crm writer's check: the day is before today in Asia/Ho_Chi_Minh. */
export function isPastDate(yyyyMmDd: string, now: Date): boolean {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return yyyyMmDd < today;
}

/** One request the in-memory facade recorded. */
export interface EvalRequest {
  kind: CustomerRequestKind;
  updated: boolean;
  details: Record<string, unknown>;
  at: Date;
}

export type EvalRequests = Pick<CrmFacade, 'recordBotRequest'> & {
  /** The requests recorded during the turn (seeded ones left out), in order. */
  readonly recorded: readonly EvalRequest[];
};

/**
 * The in-memory crm request writer of an eval case (spec §8), used in fake and live mode: the same
 * contracts validation as the crm writer (`requestDetailsSchema`, required groups, the phone,
 * `past_date` against the runner's clock, `dateLabel`, `missing` from the recommended groups) and
 * the 24 h update rule for the same kind. Unlike the crm writer it records even in preview mode
 * (the evals run through the playground): there is no database, and the checks read `recorded`.
 * `before` seeds kinds recorded an hour before the turn.
 */
export function evalRequests(
  industry: string,
  before: readonly CustomerRequestKind[] = [],
  clock: () => Date = () => new Date(),
): EvalRequests {
  const seeded = before.map((kind) => ({ kind, at: new Date(clock().getTime() - 3_600_000) }));
  const recorded: EvalRequest[] = [];
  return {
    recorded,
    recordBotRequest: async (_ws, input): Promise<BotRequestResult> => {
      const profile = requestProfileFor(industry);
      if (!profile || !isRequestIndustry(industry) || !profile.kinds.includes(input.kind))
        return { outcome: 'invalid', problems: ['kind_not_offered'] };
      const parsed = requestDetailsSchema(industry).safeParse(input.details);
      if (!parsed.success)
        return {
          outcome: 'invalid',
          problems: parsed.error.issues.map((i) =>
            i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message,
          ),
        };
      const details = parsed.data as Record<string, unknown>;
      const unmet = unmetRules(profile.required[input.kind], details);
      if (unmet.length)
        return { outcome: 'invalid', problems: unmet.map((key) => `missing:${key}`) };
      if (!normalizeAnyPhone(String(details.phone ?? '')))
        return { outcome: 'invalid', problems: ['phone: not a phone number'] };
      const now = clock();
      const date = typeof details.preferredDate === 'string' ? details.preferredDate : '';
      if (date && isPastDate(date, now)) return { outcome: 'invalid', problems: ['past_date'] };
      const since = now.getTime() - UPDATE_WINDOW_MS;
      const updated = [...seeded, ...recorded].some(
        (r) => r.kind === input.kind && r.at.getTime() >= since,
      );
      recorded.push({ kind: input.kind, updated, details, at: now });
      return {
        outcome: updated ? 'updated' : 'recorded',
        contactId: '00000000-0000-7000-8000-000000000001',
        phoneE164: '+84900000001',
        created: !updated,
        missing: unmetRules(profile.recommended[input.kind], details),
        dateLabel: date ? dateLabel(date) : null,
      };
    },
  };
}
