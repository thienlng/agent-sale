import {
  type BotDto,
  type BotReadiness,
  BotSettings,
  Industry,
  type CreateBotRequest,
  type CreateFaqRequest,
  type ImportFaqsRequest,
  type FaqDto,
  type TrainingChange,
  UpdateBotRequest,
  type UpdateFaqRequest,
} from '@agent-sales/contracts';
import { DomainError, fillPlaceholders, isUuid, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  type FaqView,
  KNOWLEDGE_FACADE,
  type KnowledgeFacade,
  TRAINING_FACADE,
  type TrainingFacade,
} from '../../knowledge/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { BOT_LIFECYCLE, type BotLifecycle } from '../api/bot-lifecycle.js';
import type { BotFacade, BotView } from '../api/bot.facade.js';
import { Bot } from '../domain/bot.js';
import type { BotSettingsData } from '../domain/bot-settings.js';
import { BotNotFoundError, InvalidBotError } from '../domain/bot.errors.js';
import { packFor } from '../domain/packs.js';
import { BOT_UOW, type BotUnitOfWork } from './ports/bot-unit-of-work.js';

class HistoryEntryNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('History entry not found');
  }
}
class NotRestorableError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('This change cannot be restored');
  }
}

/** Editable bot state as one flat record: name, on/off and every setting. */
function editable(dto: BotDto): Record<string, unknown> {
  return { name: dto.name, isActive: dto.isActive, ...dto.settings };
}
function settingsDiff(before: BotDto, after: BotDto): TrainingChange[] {
  const a = editable(before);
  const b = editable(after);
  return Object.keys(b)
    .filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]))
    .map((field) => ({ field, before: a[field] ?? null, after: b[field] }));
}

// Compile-time guard: the domain settings type and the contract must stay identical.
const _settingsMatch: [BotSettingsData, BotSettings] extends [BotSettings, BotSettingsData]
  ? true
  : never = true;
void _settingsMatch;

export function toBotDto(bot: Bot): BotDto {
  const s = bot.snapshot();
  return {
    id: s.id,
    name: s.name,
    industry: s.industry,
    isActive: s.isActive,
    settings: s.settings,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function toFaqDto(bot: Bot, faq: FaqView): FaqDto {
  return {
    id: faq.id,
    botId: faq.botId,
    question: faq.question,
    answer: faq.answer,
    source: faq.source,
    missingPlaceholders: bot
      .missingPlaceholders([faq.answer])
      .filter((p) => faq.answer.includes(p)),
    updatedAt: faq.updatedAt.toISOString(),
  };
}

/**
 * Bot use cases + the FAQ endpoints (knowledge has no HTTP of its own; the bot
 * module checks ownership first). Creating a bot seeds its industry pack in a
 * second transaction: a failure there leaves a bot without seed FAQs, which
 * the owner can add by hand — acceptable, and visible in readiness.
 */
@Injectable()
export class BotService implements BotFacade {
  private readonly log = new Logger(BotService.name);

  constructor(
    @Inject(BOT_UOW) private readonly uow: BotUnitOfWork,
    @Inject(KNOWLEDGE_FACADE) private readonly knowledge: KnowledgeFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(TRAINING_FACADE) @Optional() private readonly training?: TrainingFacade,
    @Inject(BOT_LIFECYCLE) @Optional() private readonly lifecycle?: BotLifecycle,
  ) {}

  private async load(ws: WorkspaceId, botId: string): Promise<Bot> {
    if (!isUuid(botId)) throw new BotNotFoundError(botId);
    const bot = await this.uow.run(ws, ({ bots }) => bots.findById(botId));
    if (!bot) throw new BotNotFoundError(botId);
    return bot;
  }

  async list(ws: WorkspaceId): Promise<BotDto[]> {
    return (await this.uow.run(ws, ({ bots }) => bots.list())).map(toBotDto);
  }

  async create(ws: WorkspaceId, input: CreateBotRequest): Promise<BotDto> {
    const workspace = await this.workspaces.getById(ws);
    const industry = Industry.safeParse(workspace.industry);
    if (!industry.success)
      throw new InvalidBotError('The selected business industry does not support bot creation');
    if (input.industry !== industry.data)
      throw new InvalidBotError('Bot industry must match the selected business industry');
    const bot = Bot.create({ workspaceId: ws, name: input.name, industry: industry.data });
    await this.uow.run(ws, ({ bots }) => bots.save(bot));
    await this.knowledge.seedFaqs(ws, bot.id, packFor(input.industry).faqs);
    try {
      await this.training?.seedStarterRules(ws, bot.id, '', { recordHistory: false });
    } catch {
      // Best effort: the owner can add the pack from the instructions page. No bot or shop data is logged.
      this.log.warn('starter rules seeding failed');
    }
    return toBotDto(bot);
  }

  /**
   * Soft delete: history, conversations and training rows stay, but the bot is gone
   * from every read (404). Dependents (channel pages) are unbound first.
   */
  async remove(
    ws: WorkspaceId,
    botId: string,
    actor: { userId: string | null; name: string } = { userId: null, name: '' },
  ): Promise<void> {
    const bot = await this.load(ws, botId);
    await this.lifecycle?.beforeDelete(ws, botId);
    const deleted = await this.uow.run(ws, ({ bots }) =>
      bots.softDelete(botId, {
        actorUserId: actor.userId,
        actorName: actor.name,
        botName: bot.snapshot().name,
      }),
    );
    if (!deleted) throw new BotNotFoundError(botId);
  }

  async get(ws: WorkspaceId, botId: string): Promise<BotDto> {
    return toBotDto(await this.load(ws, botId));
  }

  async update(
    ws: WorkspaceId,
    botId: string,
    change: UpdateBotRequest,
    actor = '',
  ): Promise<BotDto> {
    if (!isUuid(botId)) throw new BotNotFoundError(botId);
    const { before, updated } = await this.uow.run(ws, async ({ bots }) => {
      const bot = await bots.findById(botId);
      if (!bot) throw new BotNotFoundError(botId);
      const before = toBotDto(bot);
      if (change.name !== undefined) bot.rename(change.name);
      if (change.isActive !== undefined) bot.setActive(change.isActive);
      if (change.settings) {
        bot.updateSettings(change.settings as Partial<BotSettingsData>);
        BotSettings.parse(bot.snapshot().settings); // full settings must stay valid after merge
      }
      await bots.save(bot);
      return { before, updated: toBotDto(bot) };
    });
    const changes = settingsDiff(before, updated);
    if (changes.length)
      await this.training?.recordChange(
        ws,
        botId,
        { itemId: botId, title: updated.name, kind: 'settings', action: 'updated', changes },
        actor,
      );
    return updated;
  }

  /** Puts back the state before a history entry; the restore is itself recorded. */
  async restoreHistory(
    ws: WorkspaceId,
    botId: string,
    historyId: string,
    actor = '',
  ): Promise<void> {
    await this.load(ws, botId);
    const entry = await this.training?.historyEntry(ws, botId, historyId);
    if (!entry) throw new HistoryEntryNotFoundError();
    if (!entry.restorable) throw new NotRestorableError();
    if (entry.kind !== 'settings') {
      await this.training?.restoreItem(ws, botId, historyId, actor);
      return;
    }
    const settings: Record<string, unknown> = {};
    const change: UpdateBotRequest = {};
    for (const { field, before, after } of entry.changes) {
      if (field === 'name' && typeof before === 'string') change.name = before;
      else if (field === 'isActive' && typeof before === 'boolean') change.isActive = before;
      else if (field === 'placeholders') {
        // Placeholders merge key by key; keys added by the change are removed with ''.
        const added = Object.keys((after ?? {}) as Record<string, string>);
        settings[field] = {
          ...Object.fromEntries(added.map((key) => [key, ''])),
          ...((before ?? {}) as Record<string, string>),
        };
      } else settings[field] = before;
    }
    if (Object.keys(settings).length)
      change.settings = UpdateBotRequest.shape.settings.parse(settings);
    await this.update(ws, botId, change, actor);
  }

  async readiness(ws: WorkspaceId, botId: string): Promise<BotReadiness> {
    const bot = await this.load(ws, botId);
    const faqs = await this.knowledge.listFaqs(ws, botId);
    const r = bot.readiness(
      faqs.map((f) => f.answer),
      0,
    );
    return { ready: r.ready, checks: r.checks, missingPlaceholders: r.missing };
  }

  async listFaqs(ws: WorkspaceId, botId: string): Promise<FaqDto[]> {
    const bot = await this.load(ws, botId);
    return (await this.knowledge.listFaqs(ws, botId)).map((f) => toFaqDto(bot, f));
  }

  async importFaqs(
    ws: WorkspaceId,
    botId: string,
    input: ImportFaqsRequest,
    actor = '',
  ): Promise<FaqDto[]> {
    const bot = await this.load(ws, botId);
    const imported = await this.knowledge.importFaqs(ws, botId, input.items);
    await this.training?.recordChanges(
      ws,
      botId,
      imported.map((faq) => ({
        itemId: faq.id,
        title: faq.question,
        kind: 'faq' as const,
        action: 'created' as const,
      })),
      actor,
    );
    return imported.map((faq) => toFaqDto(bot, faq));
  }

  async createFaq(
    ws: WorkspaceId,
    botId: string,
    input: CreateFaqRequest,
    actor = '',
  ): Promise<FaqDto> {
    const bot = await this.load(ws, botId);
    const faq = await this.knowledge.createFaq(ws, botId, input);
    await this.training?.recordChange(
      ws,
      botId,
      {
        itemId: faq.id,
        title: faq.question,
        kind: 'faq',
        action: 'created',
      },
      actor,
    );
    return toFaqDto(bot, faq);
  }

  async updateFaq(
    ws: WorkspaceId,
    botId: string,
    faqId: string,
    change: UpdateFaqRequest,
    actor = '',
  ): Promise<FaqDto> {
    const bot = await this.load(ws, botId);
    const faq = await this.knowledge.updateFaq(ws, botId, faqId, change);
    await this.training?.recordChange(
      ws,
      botId,
      {
        itemId: faq.id,
        title: faq.question,
        kind: 'faq',
        action: 'updated',
      },
      actor,
    );
    return toFaqDto(bot, faq);
  }

  async deleteFaq(ws: WorkspaceId, botId: string, faqId: string, actor = ''): Promise<void> {
    await this.load(ws, botId);
    const faq = (await this.knowledge.listFaqs(ws, botId)).find((item) => item.id === faqId);
    await this.knowledge.deleteFaq(ws, botId, faqId);
    await this.training?.recordChange(
      ws,
      botId,
      {
        itemId: faqId,
        title: faq?.question ?? 'FAQ',
        kind: 'faq',
        action: 'deleted',
      },
      actor,
    );
  }

  /** BotFacade: everything the AI needs, with placeholders already filled in the greeting. */
  async getBot(ws: WorkspaceId, botId: string): Promise<BotView> {
    const s = (await this.load(ws, botId)).snapshot();
    return {
      id: s.id,
      name: s.name,
      industry: s.industry,
      isActive: s.isActive,
      ...s.settings,
      profile: {
        fields: Object.fromEntries(
          Object.entries(s.settings.profile.fields).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
        notes: s.settings.profile.notes,
      },
      greeting: fillPlaceholders(s.settings.greeting, s.settings.placeholders),
    };
  }
}
