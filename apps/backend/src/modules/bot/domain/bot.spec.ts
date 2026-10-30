import { newId, placeholdersIn, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';
import { InvalidBotError } from './bot.errors.js';
import { packFor } from './packs.js';

const ws = workspaceId(newId());

describe('Bot aggregate', () => {
  it('starts inactive with the industry pack settings', () => {
    const bot = Bot.create({ workspaceId: ws, name: ' Shop Bot ', industry: 'solar' });
    const s = bot.snapshot();
    expect(s.name).toBe('Shop Bot');
    expect(s.isActive).toBe(false);
    expect(s.settings.mission).toBe(packFor('solar').mission);
    expect(s.settings.modelTier).toBe('smart');
  });

  it('fills the profile and reply style for settings stored before they existed', () => {
    const fresh = Bot.create({ workspaceId: ws, name: 'b', industry: 'hotel' }).snapshot();
    const { profile, replyLength, tone, allowEmoji, ...old } = fresh.settings;
    void [profile, replyLength, tone, allowEmoji];
    const bot = Bot.rehydrate({ ...fresh, settings: old as typeof fresh.settings });
    const s = bot.snapshot().settings;
    expect(s.profile).toEqual({ fields: {}, notes: '' });
    expect([s.replyLength, s.tone, s.allowEmoji]).toEqual(['short', 'friendly', false]);
  });

  it('defaults a stored profile that lacks notes or fields', () => {
    const fresh = Bot.create({ workspaceId: ws, name: 'b', industry: 'hotel' }).snapshot();
    const stored = { ...fresh.settings, profile: { fields: { address: 'x' } } };
    const a = Bot.rehydrate({ ...fresh, settings: stored as never }).snapshot().settings.profile;
    expect(a).toEqual({ fields: { address: 'x' }, notes: '' });
    const b = Bot.rehydrate({
      ...fresh,
      settings: { ...stored, profile: { notes: 'n' } } as never,
    });
    expect(b.snapshot().settings.profile).toEqual({ fields: {}, notes: 'n' });
  });

  it('rejects empty or long names', () => {
    expect(() => Bot.create({ workspaceId: ws, name: ' ', industry: 'retail' })).toThrow(
      InvalidBotError,
    );
    const bot = Bot.create({ workspaceId: ws, name: 'ok', industry: 'retail' });
    expect(() => bot.rename('x'.repeat(81))).toThrow(InvalidBotError);
  });

  it('merges placeholder values key by key; an empty value removes the key', () => {
    const bot = Bot.create({ workspaceId: ws, name: 'b', industry: 'retail' });
    bot.updateSettings({ placeholders: { 'store.name': 'Rapiz Shop', 'store.hours': '8h-21h' } });
    bot.updateSettings({
      placeholders: { 'store.hours': '' },
      greeting: 'Xin chào {{store.name}}',
    });
    const s = bot.snapshot().settings;
    expect(s.placeholders).toEqual({ 'store.name': 'Rapiz Shop' });
    expect(s.greeting).toBe('Xin chào {{store.name}}');
  });

  it('readiness reports business profile completeness, not placeholders', () => {
    const bot = Bot.create({ workspaceId: ws, name: 'b', industry: 'hotel' });
    const faqs = ['a'];
    const fields = ['displayName', 'address', 'mapsUrl', 'hotline', 'hours', 'deposit', 'rates'];
    const before = bot.readiness(faqs, 0, fields);
    const profile = before.checks.find((c) => c.key === 'profile');
    expect(before.checks.some((c) => (c.key as string) === 'placeholders')).toBe(false);
    expect(profile).toEqual({ key: 'profile', done: false, detail: '7' });

    bot.updateSettings({
      profile: {
        fields: { displayName: 'A', address: 'B', hotline: 'C', hours: 'D', rates: ' ' },
        notes: '',
      },
    });
    const basics = bot.readiness(faqs, 1, fields).checks.find((c) => c.key === 'profile');
    // mapsUrl is optional and does not block the step; two industry fields stay empty.
    expect(basics).toEqual({ key: 'profile', done: true, detail: '3' });
    expect(bot.readiness(faqs, 1, fields).ready).toBe(true);
  });

  it('readiness still lists placeholders of the greeting for old bots, read-only', () => {
    const bot = Bot.create({ workspaceId: ws, name: 'b', industry: 'retail' });
    bot.updateSettings({ greeting: 'Dạ {{store.name}} xin chào ạ!' });
    const r = bot.readiness([], 0, []);
    expect(r.missing).toEqual(expect.arrayContaining(['store.name']));
    expect(r.checks.find((c) => c.key === 'profile')?.done).toBe(false);
  });

  it('the faq check counts only FAQs without an unfilled placeholder', () => {
    const bot = Bot.create({ workspaceId: ws, name: 'b', industry: 'retail' });
    const faq = (r: ReturnType<Bot['readiness']>) => r.checks.find((c) => c.key === 'faq');
    expect(faq(bot.readiness(['Hotline {{store.hotline}}'], 0, []))).toEqual({
      key: 'faq',
      done: false,
      detail: '0 FAQ',
    });
    bot.updateSettings({ placeholders: { 'store.hotline': '0901234567' } });
    expect(faq(bot.readiness(['Hotline {{store.hotline}}', 'Giờ mở cửa 8h'], 0, []))).toEqual({
      key: 'faq',
      done: true,
      detail: '2 FAQ',
    });
    expect(faq(bot.readiness(['Giá {{x.y}}', 'Giờ mở cửa 8h'], 0, []))?.detail).toBe('1 FAQ');
  });

  it('every industry pack seeds only placeholder-free greetings and FAQs', () => {
    for (const industry of [
      'retail',
      'fashion',
      'cosmetics',
      'spa',
      'dental',
      'education',
      'hotel',
      'solar',
      'saas',
      'other',
    ] as const) {
      const pack = packFor(industry);
      expect(placeholdersIn(pack.greeting), industry).toEqual([]);
      for (const f of pack.faqs) {
        expect(placeholdersIn(f.answer), `${industry}: ${f.question}`).toEqual([]);
        expect(f.answer.trim().length, `${industry}: ${f.question}`).toBeGreaterThan(5);
      }
    }
    expect(packFor('spa').faqs.map((f) => f.question)).toContain('Đặt lịch như thế nào?');
  });
});
