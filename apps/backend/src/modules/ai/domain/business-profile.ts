import { type ProfileFieldKey, profileFieldsFor } from '@agent-sales/contracts';

/** English labels for the model (prompt language); the owner-facing labels live in i18n. */
export const PROFILE_LABELS: Record<ProfileFieldKey, string> = {
  displayName: 'Display name',
  address: 'Address',
  mapsUrl: 'Maps link',
  hotline: 'Hotline',
  hours: 'Opening hours',
  payment: 'Payment methods',
  shipping: 'Shipping',
  returns: 'Returns and exchanges',
  warranty: 'Warranty',
  promotion: 'Promotions',
  sizeGuide: 'Size guide',
  authenticity: 'Authenticity',
  unitTypes: 'Room types',
  rates: 'Reference prices',
  checkInOut: 'Check-in / check-out',
  deposit: 'Deposit',
  cancellation: 'Cancellation policy',
  amenities: 'Amenities',
  childrenPets: 'Children and pets',
  directions: 'Directions',
  servicePrices: 'Service prices',
  booking: 'Booking',
  courseFees: 'Course fees',
  courseSchedule: 'Course schedule',
  courseTrial: 'Trial classes',
  priceRange: 'Price range',
  payback: 'Payback period',
};

const NOT_PROVIDED = '(not provided)';

/** Owner text is data: `<` is escaped so a value cannot close the block (same rule as `<action_result>`). */
const escape = (value: string): string => value.replace(/</g, '&lt;');

/**
 * The shop's facts as a `<business_profile>` block: every field of the bot's industry in catalog
 * order, `(not provided)` for empty ones, then the free notes when present.
 */
/** The part of a bot this block needs (structurally what `BotView` carries). */
export interface ProfileSubject {
  industry: string;
  profile: { fields: Readonly<Record<string, string | undefined>>; notes: string };
}

export function renderBusinessProfile(
  bot: ProfileSubject,
  labels: Record<string, string> = PROFILE_LABELS,
): string {
  const lines = profileFieldsFor(bot.industry).map((def) => {
    const value = bot.profile.fields[def.key]?.trim();
    return `${labels[def.key] ?? def.key}: ${value ? escape(value) : NOT_PROVIDED}`;
  });
  const notes = bot.profile.notes.trim();
  if (notes) lines.push(`Notes:\n${escape(notes)}`);
  return `<business_profile>\n${lines.join('\n')}\n</business_profile>`;
}
