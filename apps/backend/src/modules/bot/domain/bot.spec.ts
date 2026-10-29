import { newId, workspaceId } from '@agent-sales/shared';
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

  it('readiness lists placeholders used by the greeting and FAQs that have no value', () => {
    const bot = Bot.create({ workspaceId: ws, name: 'b', industry: 'retail' });
    const faqs = packFor('retail').faqs.map((f) => f.answer);
    const before = bot.readiness(faqs, 0);
    expect(before.ready).toBe(false);
    expect(before.missing).toEqual(
      expect.arrayContaining(['store.name', 'store.address', 'store.hours', 'shipping.policy']),
    );
    const values = Object.fromEntries(before.missing.map((p) => [p, `value of ${p}`]));
    bot.updateSettings({ placeholders: values });
    const after = bot.readiness(faqs, 1);
    expect(after.missing).toEqual([]);
    expect(after.ready).toBe(true);
  });

  it('every industry pack ships FAQs whose answers are concrete or placeholders, never empty', () => {
    for (const industry of [
      'retail',
      'fashion',
      'cosmetics',
      'spa',
      'dental',
      'education',
      'hotel',
      'solar',
      'other',
    ] as const) {
      const pack = packFor(industry);
      expect(pack.faqs.length, industry).toBeGreaterThanOrEqual(4);
      for (const f of pack.faqs)
        expect(f.answer.trim().length, `${industry}: ${f.question}`).toBeGreaterThan(5);
    }
  });
});
