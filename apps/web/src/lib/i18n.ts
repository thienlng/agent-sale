import { defaultLocale, type Locale, locales, resources } from '@agent-sales/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { storage } from './storage';

const LOCALE_KEY = 'rapiz.locale';

function initialLocale(): Locale {
  const saved = storage.get(LOCALE_KEY);
  return (locales as readonly string[]).includes(saved ?? '') ? (saved as Locale) : defaultLocale;
}

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: 'vi',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export function setLocale(locale: Locale): void {
  storage.set(LOCALE_KEY, locale);
  document.documentElement.lang = locale;
  void i18n.changeLanguage(locale);
}
