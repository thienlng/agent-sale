/**
 * Bot behaviour settings as the domain sees them. Mirrors contracts `BotSettings`;
 * application/bot.service.ts holds a compile-time check that both stay identical.
 */
export type ModelTier = 'basic' | 'smart' | 'pro' | 'neo';

export type IndustryKey =
  'retail' | 'fashion' | 'cosmetics' | 'spa' | 'dental' | 'education' | 'hotel' | 'solar' | 'other';

export interface BotSettingsData {
  mission: string;
  greeting: string;
  selfPronoun: string;
  customerPronoun: string;
  useCustomerName: boolean;
  autoResumeAfterManual: boolean;
  humanTakeoverMinutes: number;
  silenceOnExternalReply: boolean;
  fallbackMessage: string;
  handoffMessage: string;
  creativity: 'strict' | 'balanced' | 'creative';
  modelTier: ModelTier;
  language: 'vi' | 'en';
  themeColor: string;
  replySchedule: ReplySchedule;
  placeholders: Record<string, string>;
}

/** Daily reply window in Vietnam time; `end` before `start` spans midnight. */
export interface ReplySchedule {
  mode: 'always' | 'custom';
  start: string;
  end: string;
}
