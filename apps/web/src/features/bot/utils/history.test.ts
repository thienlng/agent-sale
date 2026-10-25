import type { TrainingHistoryDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { defaultRange, describeValue, fieldLabelKey, filterHistory, localDay } from './history';

function entry(over: Partial<TrainingHistoryDto>): TrainingHistoryDto {
  return {
    id: crypto.randomUUID(),
    botId: crypto.randomUUID(),
    itemId: crypto.randomUUID(),
    title: 'Shop Lan',
    kind: 'settings',
    action: 'updated',
    actor: 'Lan',
    changes: [],
    restorable: true,
    createdAt: new Date(2026, 9, 10, 12).toISOString(),
    ...over,
  };
}

const range = { from: '2026-10-01', to: '2026-10-24' };

describe('filterHistory', () => {
  const settings = entry({ kind: 'settings', createdAt: new Date(2026, 9, 5, 9).toISOString() });
  const faq = entry({ kind: 'faq', createdAt: new Date(2026, 9, 6, 9).toISOString() });
  const media = entry({ kind: 'media', createdAt: new Date(2026, 9, 7, 9).toISOString() });
  const old = entry({ kind: 'faq', createdAt: new Date(2026, 8, 30, 23).toISOString() });
  const all = [settings, faq, media, old];

  it('splits settings from training data', () => {
    expect(filterHistory(all, { ...range, tab: 'settings', order: 'newest' })).toEqual([settings]);
    expect(filterHistory(all, { ...range, tab: 'training', order: 'newest' })).toEqual([
      media,
      faq,
    ]);
  });

  it('keeps only entries inside the inclusive local date range', () => {
    const last = filterHistory(all, {
      from: '2026-09-30',
      to: '2026-10-06',
      tab: 'training',
      order: 'oldest',
    });
    expect(last).toEqual([old, faq]);
  });

  it('sorts oldest first on request', () => {
    expect(filterHistory(all, { ...range, tab: 'training', order: 'oldest' })).toEqual([
      faq,
      media,
    ]);
  });
});

describe('defaultRange', () => {
  it('runs from the first of the month to today', () => {
    expect(defaultRange(new Date(2026, 9, 24, 15))).toEqual({
      from: '2026-10-01',
      to: '2026-10-24',
    });
    expect(localDay(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('describeValue', () => {
  it('labels known fields and leaves unknown ones raw', () => {
    expect(fieldLabelKey('isActive')).toBe('space.history.fields.isActive');
    expect(fieldLabelKey('somethingNew')).toBeNull();
  });

  it('turns stored values into readable views', () => {
    expect(describeValue('isActive', false)).toEqual({ type: 'onOff', on: false });
    expect(describeValue('themeColor', '#112233')).toEqual({ type: 'color', value: '#112233' });
    expect(describeValue('modelTier', 'pro')).toEqual({
      type: 'option',
      key: 'space.settings.modelOptions.pro',
    });
    expect(
      describeValue('replySchedule', { mode: 'custom', start: '22:00', end: '06:00' }),
    ).toEqual({
      type: 'schedule',
      mode: 'custom',
      start: '22:00',
      end: '06:00',
    });
    expect(fieldLabelKey('enabled')).toBe('space.history.fields.enabled');
    expect(fieldLabelKey('section')).toBe('space.history.fields.section');
    expect(describeValue('enabled', false)).toEqual({ type: 'onOff', on: false });
    expect(describeValue('section', 'after_order')).toEqual({
      type: 'option',
      key: 'space.history.ruleSections.after_order',
    });
    expect(describeValue('mission', null)).toEqual({ type: 'empty' });
    expect(describeValue('placeholders', { 'store.address': '12 Lê Lợi' })).toEqual({
      type: 'text',
      text: 'store.address: 12 Lê Lợi',
    });
  });

  it('truncates long text', () => {
    const view = describeValue('content', 'x'.repeat(200));
    expect(view.type === 'text' && view.text.length).toBe(80);
  });
});
