import { describe, expect, it } from 'vitest';
import { i18n, setLocale } from './i18n';

describe('i18n catalogs', () => {
  it('starts in Vietnamese with only the Vietnamese catalog bundled', () => {
    expect(i18n.language).toBe('vi');
    expect(i18n.t('rules.title', { ns: 'training' })).toBe('Quy tắc cho Bot');
    expect(i18n.hasResourceBundle('en', 'common')).toBe(false);
  });

  it('loads English on demand when the user switches language', async () => {
    setLocale('en');
    await expect.poll(() => i18n.language).toBe('en');
    expect(i18n.t('rules.title', { ns: 'training' })).toBe('Bot rules');
    setLocale('vi');
    await expect.poll(() => i18n.language).toBe('vi');
  });
});
