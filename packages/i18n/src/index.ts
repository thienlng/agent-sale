import en from './messages/en/common.json' with { type: 'json' };
import vi from './messages/vi/common.json' with { type: 'json' };

export const locales = ['vi', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'vi';

export const resources = {
  vi: { common: vi },
  en: { common: en },
} as const;

export type CommonMessages = typeof vi;
