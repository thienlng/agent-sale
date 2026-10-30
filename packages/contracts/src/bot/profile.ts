import { z } from 'zod';

import type { Industry } from './industry.js';

export type ProfileGroup = 'basic' | 'industry';

export type ProfileFieldKey =
  | 'displayName'
  | 'address'
  | 'mapsUrl'
  | 'hotline'
  | 'hours'
  | 'payment'
  | 'shipping'
  | 'returns'
  | 'warranty'
  | 'promotion'
  | 'sizeGuide'
  | 'authenticity'
  | 'unitTypes'
  | 'rates'
  | 'checkInOut'
  | 'deposit'
  | 'cancellation'
  | 'amenities'
  | 'childrenPets'
  | 'directions'
  | 'servicePrices'
  | 'booking'
  | 'courseFees'
  | 'courseSchedule'
  | 'courseTrial'
  | 'priceRange'
  | 'payback';

export interface ProfileFieldDef {
  key: ProfileFieldKey;
  group: ProfileGroup;
  /** Maximum characters of the value. */
  max: number;
  /** Industries that show the field; `all` for the basic group. */
  industries: 'all' | readonly Industry[];
}

const basic = (key: ProfileFieldKey, max: number): ProfileFieldDef => ({
  key,
  group: 'basic',
  max,
  industries: 'all',
});
const industry = (
  key: ProfileFieldKey,
  max: number,
  industries: readonly Industry[],
): ProfileFieldDef => ({ key, group: 'industry', max, industries });

const SHOPS = ['retail', 'fashion', 'cosmetics'] as const;

/**
 * Every profile field with its limit and the industries that use it. Keys are English;
 * labels live in i18n. A key appears once, so `payment` and `warranty` list every
 * industry that shares them.
 */
export const PROFILE_FIELDS: readonly ProfileFieldDef[] = [
  basic('displayName', 120),
  basic('address', 300),
  basic('mapsUrl', 500),
  basic('hotline', 60),
  basic('hours', 200),
  industry('payment', 500, [...SHOPS, 'spa', 'dental']),
  industry('shipping', 1000, SHOPS),
  industry('returns', 1000, SHOPS),
  industry('warranty', 500, [...SHOPS, 'solar']),
  industry('promotion', 500, SHOPS),
  industry('sizeGuide', 1000, ['fashion']),
  industry('authenticity', 500, ['cosmetics']),
  industry('unitTypes', 1000, ['hotel']),
  industry('rates', 1000, ['hotel']),
  industry('checkInOut', 200, ['hotel']),
  industry('deposit', 500, ['hotel']),
  industry('cancellation', 500, ['hotel']),
  industry('amenities', 1000, ['hotel']),
  industry('childrenPets', 500, ['hotel']),
  industry('directions', 1000, ['hotel']),
  industry('servicePrices', 1000, ['spa', 'dental']),
  industry('booking', 500, ['spa', 'dental']),
  industry('courseFees', 1000, ['education']),
  industry('courseSchedule', 1000, ['education']),
  industry('courseTrial', 500, ['education']),
  industry('priceRange', 1000, ['solar']),
  industry('payback', 500, ['solar']),
];

/** Fields shown for an industry: the basic group first, then its own. Unknown industry: basic only. */
/** Basic fields every bot needs before going live (`mapsUrl` stays optional). */
export const REQUIRED_PROFILE_FIELDS = ['displayName', 'address', 'hotline', 'hours'] as const;

export function profileFieldsFor(industryKey: string): ProfileFieldDef[] {
  return PROFILE_FIELDS.filter(
    (f) =>
      f.group === 'basic' ||
      (f.industries !== 'all' && (f.industries as readonly string[]).includes(industryKey)),
  );
}

export const PROFILE_NOTES_MAX = 3000;

const HttpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    if (v === '') return true;
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https URL');

const fieldShape = Object.fromEntries(
  PROFILE_FIELDS.map((f) => [
    f.key,
    (f.key === 'mapsUrl' ? HttpsUrl : z.string().trim().max(f.max)).optional(),
  ]),
) as Record<ProfileFieldKey, z.ZodOptional<z.ZodString>>;

/** Structured business facts of one bot plus free notes. Values are data, never instructions. */
export const BotProfile = z.object({
  fields: z.strictObject(fieldShape),
  notes: z.string().trim().max(PROFILE_NOTES_MAX),
});
export type BotProfile = z.infer<typeof BotProfile>;
