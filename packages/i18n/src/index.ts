import { en } from './en.js';
import vi from './messages/vi/common.json' with { type: 'json' };
import { vi as viCatalog } from './vi.js';

export { defaultLocale, type Locale, locales } from './locales.js';

/** Both catalogs. The web app imports `./vi` and `./en` separately to keep English lazy. */
export const resources = { vi: viCatalog, en } as const;

export type CommonMessages = typeof vi;
