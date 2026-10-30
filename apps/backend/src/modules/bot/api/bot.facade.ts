import type { WorkspaceId } from '@agent-sales/shared';

/** What other modules (ai, conversation) may know about a bot. */
export interface BotView {
  id: string;
  name: string;
  industry: string;
  isActive: boolean;
  /** 'selected': the AI may only offer the products chosen for this bot (T-080). */
  catalogMode: 'all' | 'selected';
  mission: string;
  greeting: string;
  selfPronoun: string;
  customerPronoun: string;
  fallbackMessage: string;
  handoffMessage: string;
  creativity: 'strict' | 'balanced' | 'creative';
  modelTier: 'basic' | 'smart' | 'pro' | 'neo';
  language: 'vi' | 'en';
  autoResumeAfterManual?: boolean;
  humanTakeoverMinutes?: number;
  silenceOnExternalReply?: boolean;
  replySchedule?: { mode: 'always' | 'custom'; start: string; end: string };
  profile: { fields: Readonly<Record<string, string>>; notes: string };
  replyLength: 'veryShort' | 'short' | 'detailed';
  tone: 'friendly' | 'formal';
  allowEmoji: boolean;
  placeholders: Readonly<Record<string, string>>;
}

/** PUBLIC CONTRACT of the bot module. */
export interface BotFacade {
  /** Throws NOT_FOUND when the bot does not exist in the workspace. */
  getBot(workspaceId: WorkspaceId, botId: string): Promise<BotView>;
}

export const BOT_FACADE = Symbol('BOT_FACADE');
