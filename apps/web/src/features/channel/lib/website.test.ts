import { WebsiteSettings } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import { diffSettings, embedCode, parseDomains, validateSettingsForm, toForm } from './website';

describe('embedCode', () => {
  it('renders the script tag with the site key', () => {
    expect(embedCode('wk_abc123', 'https://w.test/widget.js')).toBe(
      '<script src="https://w.test/widget.js?key=wk_abc123" async></script>',
    );
  });
});

describe('parseDomains', () => {
  it('splits on commas, spaces and new lines, lowercases and de-duplicates', () => {
    expect(parseDomains('Shop.vn, www.shop.vn\nshop.vn')).toEqual({
      valid: ['shop.vn', 'www.shop.vn'],
      invalid: [],
    });
  });
  it('rejects schemes, paths and ports', () => {
    const result = parseDomains('https://x.vn/a, y.vn:8080, ok.vn');
    expect(result.valid).toEqual(['ok.vn']);
    expect(result.invalid).toEqual(['https://x.vn/a', 'y.vn:8080']);
  });
});

const base = WebsiteSettings.parse({ domains: ['shop.vn'] });

describe('diffSettings', () => {
  it('returns only changed fields', () => {
    expect(diffSettings(base, { ...base, color: '#000000', domains: ['shop.vn'] })).toEqual({
      color: '#000000',
    });
    expect(diffSettings(base, { ...base, domains: ['shop.vn', 'a.vn'] })).toEqual({
      domains: ['shop.vn', 'a.vn'],
    });
    expect(diffSettings(base, base)).toEqual({});
  });
});

describe('validateSettingsForm', () => {
  it('accepts the defaults and normalises empty avatar to null', () => {
    const result = validateSettingsForm(toForm(base));
    expect(result.ok && result.settings).toEqual(base);
  });
  it('reports the failing fields', () => {
    const result = validateSettingsForm({
      ...toForm(base),
      color: 'red',
      domains: 'https://x.vn',
      avatarUrl: 'http://insecure.vn/a.png',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual([
      'avatarUrl',
      'color',
      'domains',
    ]);
  });
});
