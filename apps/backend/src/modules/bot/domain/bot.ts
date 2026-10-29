import { REQUIRED_PROFILE_FIELDS } from '@agent-sales/contracts';
import { newId, placeholdersIn, type WorkspaceId } from '@agent-sales/shared';

import type { BotSettingsData, IndustryKey } from './bot-settings.js';
import { InvalidBotError } from './bot.errors.js';
import { defaultSettings } from './packs.js';

export interface BotProps {
  id: string;
  workspaceId: WorkspaceId;
  name: string;
  industry: IndustryKey;
  isActive: boolean;
  settings: BotSettingsData;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReadinessCheck {
  key: 'mission' | 'faq' | 'profile' | 'channel';
  done: boolean;
  detail?: string;
}

function validName(name: string): string {
  const n = name.trim();
  if (n.length < 1 || n.length > 80) throw new InvalidBotError('name must be 1–80 characters');
  return n;
}

/** Stored settings may predate newer keys, including parts of `profile`: default them deeply. */
function withDefaults(industry: IndustryKey, stored: Partial<BotSettingsData>): BotSettingsData {
  const defaults = defaultSettings(industry);
  return {
    ...defaults,
    ...stored,
    profile: {
      fields: { ...(stored.profile?.fields ?? {}) },
      notes: stored.profile?.notes ?? '',
    },
  };
}

/** Settings change as validated by the contract: `profile` is a partial that merges into the stored one. */
export type BotSettingsChange = Omit<Partial<BotSettingsData>, 'profile'> & {
  profile?: { fields?: Partial<Record<string, string>>; notes?: string };
};

export class Bot {
  private constructor(private props: BotProps) {}

  /** New bots start inactive with the industry pack's settings. */
  static create(input: { workspaceId: WorkspaceId; name: string; industry: IndustryKey }): Bot {
    const now = new Date();
    return new Bot({
      id: newId(),
      workspaceId: input.workspaceId,
      name: validName(input.name),
      industry: input.industry,
      isActive: false,
      settings: defaultSettings(input.industry),
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: BotProps): Bot {
    return new Bot({
      ...props,
      settings: withDefaults(props.industry, props.settings),
    });
  }

  rename(name: string): void {
    this.props = { ...this.props, name: validName(name), updatedAt: new Date() };
  }

  setActive(active: boolean): void {
    this.props = { ...this.props, isActive: active, updatedAt: new Date() };
  }

  /**
   * Merges validated partial settings; placeholders and profile fields merge key by key
   * (empty string removes); profile notes change only when sent.
   */
  updateSettings(change: BotSettingsChange): void {
    const placeholders = { ...this.props.settings.placeholders, ...(change.placeholders ?? {}) };
    for (const [k, v] of Object.entries(placeholders)) if (v === '') delete placeholders[k];
    const fields = { ...this.props.settings.profile.fields, ...(change.profile?.fields ?? {}) };
    for (const [k, v] of Object.entries(fields)) if (v === '' || v === undefined) delete fields[k];
    const profile = { fields, notes: change.profile?.notes ?? this.props.settings.profile.notes };
    this.props = {
      ...this.props,
      settings: { ...this.props.settings, ...change, profile, placeholders },
      updatedAt: new Date(),
    };
  }

  /** Placeholders used by the greeting or the given FAQ answers that have no value yet. */
  missingPlaceholders(texts: readonly string[], withGreeting = true): string[] {
    const used = new Set(
      [...(withGreeting ? [this.props.settings.greeting] : []), ...texts].flatMap(placeholdersIn),
    );
    return [...used].filter((p) => !this.props.settings.placeholders[p]);
  }

  /**
   * Onboarding checklist (docs/02 BOT-04). The profile check is done when the basic fields are
   * filled; its detail is how many of `profileFieldKeys` (the industry's fields) are still empty.
   * `missing` lists the unfilled placeholders (read-only, kept one release for old clients).
   */
  readiness(
    faqAnswers: readonly string[],
    channels: number,
    profileFieldKeys: readonly string[],
  ): { ready: boolean; checks: ReadinessCheck[]; missing: string[] } {
    const missing = this.missingPlaceholders(faqAnswers);
    // An FAQ whose answer still has an unfilled placeholder is never used by the bot: not counted.
    const answerable = faqAnswers.filter((a) => this.missingPlaceholders([a], false).length === 0);
    const filled = (key: string) => Boolean(this.props.settings.profile.fields[key]?.trim());
    const empty = profileFieldKeys.filter((k) => !filled(k)).length;
    const checks: ReadinessCheck[] = [
      { key: 'mission', done: this.props.settings.mission.trim().length >= 20 },
      { key: 'faq', done: answerable.length > 0, detail: `${answerable.length} FAQ` },
      {
        key: 'profile',
        done: REQUIRED_PROFILE_FIELDS.every(filled),
        detail: String(empty),
      },
      { key: 'channel', done: channels > 0 },
    ];
    return { ready: checks.every((c) => c.done), checks, missing };
  }

  get id(): string {
    return this.props.id;
  }

  snapshot(): Readonly<BotProps> {
    return { ...this.props, settings: { ...this.props.settings } };
  }
}
