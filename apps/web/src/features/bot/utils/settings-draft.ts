import type { BotSettings, ReplySchedule, UpdateBotRequest } from '@agent-sales/contracts';

/** What the settings form edits: the bot name plus its behaviour settings. */
export interface SettingsDraft {
  name: string;
  settings: BotSettings;
}

export type SettingsProblem = 'name' | 'themeColor' | 'replySchedule';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The PATCH body: only the fields that differ from what was loaded. */
export function changedFields(draft: SettingsDraft, initial: SettingsDraft): UpdateBotRequest {
  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(draft.settings) as Array<keyof BotSettings>) {
    if (JSON.stringify(draft.settings[key]) !== JSON.stringify(initial.settings[key])) {
      settings[key] = draft.settings[key];
    }
  }
  return {
    ...(draft.name !== initial.name ? { name: draft.name } : {}),
    ...(Object.keys(settings).length ? { settings: settings as UpdateBotRequest['settings'] } : {}),
  };
}

/** A custom reply window needs a start and an end that differ (end < start spans midnight). */
export function scheduleIsValid(schedule: ReplySchedule): boolean {
  return (
    schedule.mode === 'always' ||
    (Boolean(schedule.start && schedule.end) && schedule.start !== schedule.end)
  );
}

/** Fields the server would reject, checked before saving. */
export function settingsProblems(draft: SettingsDraft): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  if (!draft.name.trim()) problems.push('name');
  if (!HEX.test(draft.settings.themeColor)) problems.push('themeColor');
  if (!scheduleIsValid(draft.settings.replySchedule)) problems.push('replySchedule');
  return problems;
}
