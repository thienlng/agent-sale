import type { UnitRecord } from '../../application/ports/lodging-store.js';

/** The T-193 unit details at their defaults, for unit builders in lodging specs. */
export const unitDetails = (): Pick<
  UnitRecord,
  | 'category'
  | 'view'
  | 'areaM2'
  | 'description'
  | 'amenities'
  | 'maxGuests'
  | 'gallery'
  | 'galleryCover'
> => ({
  category: 'room',
  view: '',
  areaM2: null,
  description: '',
  amenities: [],
  maxGuests: null,
  gallery: [],
  galleryCover: '',
});
