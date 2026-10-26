import { defaultLocale, type Locale, locales } from '@agent-sales/i18n/locales';
import { vi } from '@agent-sales/i18n/vi';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { storage } from './storage';

const LOCALE_KEY = 'rapiz.locale';

function initialLocale(): Locale {
  const saved = storage.get(LOCALE_KEY);
  return (locales as readonly string[]).includes(saved ?? '') ? (saved as Locale) : defaultLocale;
}

/** Vietnamese ships with the app; other catalogs are fetched when first used (bundle budget). */
const loaders: Record<Exclude<Locale, 'vi'>, () => Promise<typeof vi>> = {
  en: () => import('@agent-sales/i18n/en').then((m) => m.en),
};

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: { vi },
  partialBundledLanguages: true,
  lng: 'vi',
  fallbackLng: 'vi',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

async function load(locale: Locale): Promise<void> {
  if (locale === 'vi' || i18n.hasResourceBundle(locale, 'common')) return;
  const catalog = await loaders[locale]();
  for (const [ns, messages] of Object.entries(catalog))
    i18n.addResourceBundle(locale, ns, messages, true, true);
}

async function switchTo(locale: Locale): Promise<void> {
  try {
    await load(locale);
    await i18n.changeLanguage(locale);
  } catch {
    // The catalog could not be fetched (offline): stay on the bundled Vietnamese.
  }
}

// A saved non-default locale shows Vietnamese for the moment its catalog takes to arrive.
const saved = initialLocale();
if (saved !== 'vi') void switchTo(saved);

export function setLocale(locale: Locale): void {
  storage.set(LOCALE_KEY, locale);
  document.documentElement.lang = locale;
  void switchTo(locale);
}
