import { describe, expect, it } from 'vitest';
import {
  CreateWebsiteRequest,
  Hostname,
  UpdateWebsiteRequest,
  WebsiteSettings,
} from './website.schema.js';

describe('Hostname', () => {
  it('accepts bare hosts and localhost, lowercasing them', () => {
    expect(Hostname.parse('Shop.Example.vn')).toBe('shop.example.vn');
    expect(Hostname.parse('localhost')).toBe('localhost');
  });
  it.each(['https://x.vn', 'x.vn/path', 'x.vn:80', '-x.vn', 'x..vn', '', 'vn', 'com'])(
    'rejects %s',
    (v) => expect(Hostname.safeParse(v).success).toBe(false),
  );
});
describe('Hostname dots', () => {
  it('needs a dot except for localhost', () => {
    expect(Hostname.safeParse('vn').success).toBe(false);
    expect(Hostname.safeParse('localhost').success).toBe(true);
    expect(Hostname.safeParse('shop.vn').success).toBe(true);
  });
});
describe('WebsiteSettings', () => {
  it('fills the Rapiz defaults', () => {
    const s = WebsiteSettings.parse({ domains: ['shop.vn'] });
    expect(s).toMatchObject({
      color: '#F97316',
      position: 'right',
      avatarUrl: null,
      requirePhoneAfter: 0,
    });
    expect(s.greeting.length).toBeGreaterThan(0);
  });
  it('needs 1 to 10 domains and an https avatar', () => {
    expect(WebsiteSettings.safeParse({ domains: [] }).success).toBe(false);
    expect(
      WebsiteSettings.safeParse({
        domains: Array.from({ length: 11 }, (_, i) => `a${i}.vn`),
      }).success,
    ).toBe(false);
    expect(
      WebsiteSettings.safeParse({ domains: ['a.vn'], avatarUrl: 'http://a.vn/x.png' }).success,
    ).toBe(false);
  });
});
describe('website requests', () => {
  it('create requires name and domains; update is partial without defaults', () => {
    expect(CreateWebsiteRequest.safeParse({ name: 'Shop', domains: ['shop.vn'] }).success).toBe(
      true,
    );
    expect(UpdateWebsiteRequest.parse({ enabled: false })).toEqual({ enabled: false });
  });
  it('update rejects unknown keys instead of ignoring them', () => {
    expect(UpdateWebsiteRequest.safeParse({ settings: { color: '#000000' } }).success).toBe(false);
    expect(UpdateWebsiteRequest.safeParse({ enabled: true, colour: '#000000' }).success).toBe(
      false,
    );
    expect(UpdateWebsiteRequest.safeParse({ color: '#000000' }).success).toBe(true);
  });
});
