import { describe, expect, it } from 'vitest';
import { i18n, loadNamespace, setLocale } from './i18n';

describe('i18n catalogs', () => {
  it('starts in Vietnamese with only the Vietnamese catalog bundled', () => {
    expect(i18n.language).toBe('vi');
    expect(i18n.t('rules.title', { ns: 'training' })).toBe('Hướng dẫn trả lời');
    expect(i18n.hasResourceBundle('en', 'common')).toBe(false);
  });

  it('loads English on demand when the user switches language', async () => {
    setLocale('en');
    await expect.poll(() => i18n.language).toBe('en');
    expect(i18n.t('rules.title', { ns: 'training' })).toBe('Reply guidance');
    setLocale('vi');
    await expect.poll(() => i18n.language).toBe('vi');
  });

  it('keeps lazy namespaces out until a page loads them, then has them in every locale', async () => {
    expect(i18n.hasResourceBundle('vi', 'integration')).toBe(false);
    await loadNamespace('integration');
    expect(i18n.t('hub.title', { ns: 'integration' })).toBe('Tích hợp PMS');
    expect(i18n.getFixedT('en', 'integration')('hub.title')).toBe('PMS integrations');
  });
});
