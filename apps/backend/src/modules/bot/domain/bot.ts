import { newId, placeholdersIn, type WorkspaceId } from '@agent-sales/shared';

import type { BotSettingsData, IndustryKey } from './bot-settings.js';
import { InvalidBotError } from './bot.errors.js';
import { defaultSettings } from './packs.js';

export type CatalogMode = 'all' | 'selected';

export interface BotProps {
  id: string;
  workspaceId: WorkspaceId;
  name: string;
  industry: IndustryKey;
  isActive: boolean;
  /** 'all' sells every active product; 'selected' only the products chosen for the bot. */
  catalogMode: CatalogMode;
  settings: BotSettingsData;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReadinessCheck {
  key: 'mission' | 'faq' | 'placeholders' | 'channel';
  done: boolean;
  detail?: string;
}

function validName(name: string): string {
  const n = name.trim();
  if (n.length < 1 || n.length > 80) throw new InvalidBotError('name must be 1–80 characters');
  return n;
}

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
      catalogMode: 'all',
      settings: defaultSettings(input.industry),
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: BotProps): Bot {
    return new Bot({
      ...props,
      settings: { ...defaultSettings(props.industry), ...props.settings },
    });
  }

  rename(name: string): void {
    this.props = { ...this.props, name: validName(name), updatedAt: new Date() };
  }

  setActive(active: boolean): void {
    this.props = { ...this.props, isActive: active, updatedAt: new Date() };
  }

  setCatalogMode(mode: CatalogMode): void {
    this.props = { ...this.props, catalogMode: mode, updatedAt: new Date() };
  }

  /** Merges validated partial settings; placeholders merge key by key (empty string removes). */
  updateSettings(change: Partial<BotSettingsData>): void {
    const placeholders = { ...this.props.settings.placeholders, ...(change.placeholders ?? {}) };
    for (const [k, v] of Object.entries(placeholders)) if (v === '') delete placeholders[k];
    this.props = {
      ...this.props,
      settings: { ...this.props.settings, ...change, placeholders },
      updatedAt: new Date(),
    };
  }

  /** Placeholders used by the greeting or the given FAQ answers that have no value yet. */
  missingPlaceholders(texts: readonly string[]): string[] {
    const used = new Set([this.props.settings.greeting, ...texts].flatMap(placeholdersIn));
    return [...used].filter((p) => !this.props.settings.placeholders[p]);
  }

  /** Onboarding checklist (docs/02 BOT-04). `channels` is 0 until M3 connects channels. */
  readiness(
    faqAnswers: readonly string[],
    channels: number,
  ): { ready: boolean; checks: ReadinessCheck[]; missing: string[] } {
    const missing = this.missingPlaceholders(faqAnswers);
    const checks: ReadinessCheck[] = [
      { key: 'mission', done: this.props.settings.mission.trim().length >= 20 },
      { key: 'faq', done: faqAnswers.length > 0, detail: `${faqAnswers.length} FAQ` },
      {
        key: 'placeholders',
        done: missing.length === 0,
        ...(missing.length ? { detail: missing.join(', ') } : {}),
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
