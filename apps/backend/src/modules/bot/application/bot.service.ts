import {
  type BotDto,
  type BotReadiness,
  BotSettings,
  type CreateBotRequest,
  type CreateFaqRequest,
  type ImportFaqsRequest,
  type FaqDto,
  type UpdateBotRequest,
  type UpdateFaqRequest,
} from '@agent-sales/contracts';
import { fillPlaceholders, isUuid, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  type FaqView,
  KNOWLEDGE_FACADE,
  type KnowledgeFacade,
  TRAINING_FACADE,
  type TrainingFacade,
} from '../../knowledge/api/index.js';
import type { BotFacade, BotView } from '../api/bot.facade.js';
import { Bot } from '../domain/bot.js';
import type { BotSettingsData } from '../domain/bot-settings.js';
import { BotNotFoundError } from '../domain/bot.errors.js';
import { packFor } from '../domain/packs.js';
import { BOT_UOW, type BotUnitOfWork } from './ports/bot-unit-of-work.js';

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
  constructor(
    @Inject(BOT_UOW) private readonly uow: BotUnitOfWork,
    @Inject(KNOWLEDGE_FACADE) private readonly knowledge: KnowledgeFacade,
    @Inject(TRAINING_FACADE) @Optional() private readonly training?: TrainingFacade,
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
    const bot = Bot.create({ workspaceId: ws, name: input.name, industry: input.industry });
    await this.uow.run(ws, ({ bots }) => bots.save(bot));
    await this.knowledge.seedFaqs(ws, bot.id, packFor(input.industry).faqs);
    return toBotDto(bot);
  }

  async get(ws: WorkspaceId, botId: string): Promise<BotDto> {
    return toBotDto(await this.load(ws, botId));
  }

  async update(ws: WorkspaceId, botId: string, change: UpdateBotRequest): Promise<BotDto> {
    if (!isUuid(botId)) throw new BotNotFoundError(botId);
    const updated = await this.uow.run(ws, async ({ bots }) => {
      const bot = await bots.findById(botId);
      if (!bot) throw new BotNotFoundError(botId);
      if (change.name !== undefined) bot.rename(change.name);
      if (change.isActive !== undefined) bot.setActive(change.isActive);
      if (change.settings) {
        bot.updateSettings(change.settings as Partial<BotSettingsData>);
        BotSettings.parse(bot.snapshot().settings); // full settings must stay valid after merge
      }
      await bots.save(bot);
      return toBotDto(bot);
    });
    if (Object.keys(change).length)
      await this.training?.recordChange(ws, botId, {
        itemId: botId,
        title: updated.name,
        kind: 'settings',
        action: 'updated',
      });
    return updated;
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

  async importFaqs(ws: WorkspaceId, botId: string, input: ImportFaqsRequest): Promise<FaqDto[]> {
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
    );
    return imported.map((faq) => toFaqDto(bot, faq));
  }

  async createFaq(ws: WorkspaceId, botId: string, input: CreateFaqRequest): Promise<FaqDto> {
    const bot = await this.load(ws, botId);
    const faq = await this.knowledge.createFaq(ws, botId, input);
    await this.training?.recordChange(ws, botId, {
      itemId: faq.id,
      title: faq.question,
      kind: 'faq',
      action: 'created',
    });
    return toFaqDto(bot, faq);
  }

  async updateFaq(
    ws: WorkspaceId,
    botId: string,
    faqId: string,
    change: UpdateFaqRequest,
  ): Promise<FaqDto> {
    const bot = await this.load(ws, botId);
    const faq = await this.knowledge.updateFaq(ws, botId, faqId, change);
    await this.training?.recordChange(ws, botId, {
      itemId: faq.id,
      title: faq.question,
      kind: 'faq',
      action: 'updated',
    });
    return toFaqDto(bot, faq);
  }

  async deleteFaq(ws: WorkspaceId, botId: string, faqId: string): Promise<void> {
    await this.load(ws, botId);
    const faq = (await this.knowledge.listFaqs(ws, botId)).find((item) => item.id === faqId);
    await this.knowledge.deleteFaq(ws, botId, faqId);
    await this.training?.recordChange(ws, botId, {
      itemId: faqId,
      title: faq?.question ?? 'FAQ',
      kind: 'faq',
      action: 'deleted',
    });
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
      greeting: fillPlaceholders(s.settings.greeting, s.settings.placeholders),
    };
  }
}
