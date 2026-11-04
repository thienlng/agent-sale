import { z } from 'zod';

/** Industries with a seed pack (docs/17 §3). `other` gets a generic pack. */
export const Industry = z.enum([
  'retail',
  'fashion',
  'cosmetics',
  'spa',
  'dental',
  'education',
  'hotel',
  'solar',
  'saas',
  'other',
]);
export type Industry = z.infer<typeof Industry>;

/**
 * Industries a new business can pick at sign-up or creation: the verticals with a verified
 * product flow. The other values stay valid for existing businesses.
 */
export const SELECTABLE_INDUSTRIES = [
  'retail',
  'hotel',
  'saas',
  'education',
  'spa',
] as const satisfies readonly Industry[];
