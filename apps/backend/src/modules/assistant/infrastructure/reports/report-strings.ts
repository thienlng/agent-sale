import { notificationStrings } from '@agent-sales/i18n/notification';

import type { ReportStringsSource } from '../../domain/ports/report-data-source.port.js';

const cache = new Map<'vi' | 'en', Record<string, string>>();

/** The report texts from `@agent-sales/i18n/notification` (S3-R6), flattened once per language. */
export const i18nReportStrings: ReportStringsSource = (locale) => {
  let strings = cache.get(locale);
  if (!strings) {
    strings = notificationStrings(locale);
    cache.set(locale, strings);
  }
  return strings;
};
