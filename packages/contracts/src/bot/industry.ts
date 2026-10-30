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
  'other',
]);
export type Industry = z.infer<typeof Industry>;
