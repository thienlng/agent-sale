import type { BotSettings } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import {
  changedFields,
  scheduleIsValid,
  settingsProblems,
  type SettingsDraft,
} from './settings-draft';

const settings: BotSettings = {
  mission: 'Bán áo',
  greeting: 'Xin chào',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  useCustomerName: true,
  autoResumeAfterManual: true,
  humanTakeoverMinutes: 5,
  silenceOnExternalReply: true,
  fallbackMessage: '',
  handoffMessage: '',
  creativity: 'balanced',
  modelTier: 'smart',
  language: 'vi',
  themeColor: '#FF6600',
  replySchedule: { mode: 'always', start: '08:00', end: '22:00' },
  profile: { fields: {}, notes: '' },
  replyLength: 'short',
  tone: 'friendly',
  allowEmoji: false,
  placeholders: {},
};
const initial: SettingsDraft = { name: 'Shop Lan', settings };

describe('changedFields', () => {
  it('is empty when nothing changed', () => {
    expect(changedFields(initial, initial)).toEqual({});
  });

  it('sends the name at top level and only the changed settings', () => {
    const draft: SettingsDraft = {
      name: 'Shop Mai',
      settings: {
        ...settings,
        themeColor: '#112233',
        replySchedule: { mode: 'custom', start: '22:00', end: '06:00' },
      },
    };
    expect(changedFields(draft, initial)).toEqual({
      name: 'Shop Mai',
      settings: {
        themeColor: '#112233',
        replySchedule: { mode: 'custom', start: '22:00', end: '06:00' },
      },
    });
  });
});

describe('settings validation', () => {
  it('accepts an overnight window and rejects an empty one', () => {
    expect(scheduleIsValid({ mode: 'custom', start: '22:00', end: '06:00' })).toBe(true);
    expect(scheduleIsValid({ mode: 'custom', start: '08:00', end: '08:00' })).toBe(false);
    expect(scheduleIsValid({ mode: 'always', start: '08:00', end: '08:00' })).toBe(true);
  });

  it('flags a blank name, a malformed colour and an empty window', () => {
    const draft: SettingsDraft = {
      name: ' ',
      settings: {
        ...settings,
        themeColor: '#12',
        replySchedule: { mode: 'custom', start: '09:00', end: '09:00' },
      },
    };
    expect(settingsProblems(draft)).toEqual(['name', 'themeColor', 'replySchedule']);
    expect(settingsProblems(initial)).toEqual([]);
  });
});
