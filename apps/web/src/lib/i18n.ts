import { defaultLocale, resources } from '@agent-sales/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLocale,
  fallbackLng: 'vi',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});
