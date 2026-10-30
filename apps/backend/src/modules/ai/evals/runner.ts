import { FakeLlmProvider } from '@agent-sales/ai-core';
import type { PlaygroundRequest, TrainingItemDto } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';

import type { ActionFacade } from '../../action/api/index.js';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CatalogFacade } from '../../commerce/api/index.js';
import type { FaqHit, KnowledgeFacade, TrainingFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import type { LlmProviderFactory } from '../application/ports/llm-provider-factory.js';
import { DEV_FAKE_PROVIDER } from '../domain/llm-config.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';
import { type CheckResult, runChecks } from './checks.js';
import type { EvalCase, EvalOutcome } from './case.js';

export interface CaseResult {
  id: string;
  group: string;
  tags: string[];
  critical: boolean;
  pass: boolean;
  checks: CheckResult[];
  customer: string;
  reply: string;
  outcome: EvalOutcome | null;
  guardrail: string | null;
  /** `name@version` of the prompt the pipeline used (from its ai_run record). */
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  /** Set when the pipeline itself failed (provider down, no fake reply); the case then fails. */
  error: string | null;
}

/** The case's bot, with every field of `BotView` filled; it sells every product of the case. */
export function botFor(c: EvalCase, botId: string): BotView {
  return { id: botId, isActive: true, catalogMode: 'all', ...c.bot };
}

/** What the reply may state figures from: only the case's own fixtures (not generated ids). */
export function trustedTexts(c: EvalCase): string[] {
  return [
    c.bot.mission,
    c.bot.greeting,
    ...Object.values(c.bot.placeholders),
    ...Object.values(c.bot.profile.fields),
    c.bot.profile.notes,
    ...c.faqs.flatMap((f) => [f.question, f.answer]),
    ...c.situations.flatMap((s) => [s.title, s.trigger ?? '', s.content]),
    ...c.products.flatMap((p) => [
      p.name,
      p.code ?? '',
      p.description,
      p.instructions,
      ...(p.accommodation ? [JSON.stringify(p.accommodation)] : []),
      ...p.variants.flatMap((v) => [v.name, v.sku ?? '', String(v.price), String(v.stock)]),
    ]),
  ];
}

function productDtos(c: EvalCase) {
  const stamp = new Date(0).toISOString();
  return c.products.map((p, i) => {
    const prices = p.variants.map((v) => v.price);
    return {
      id: newId(),
      code: p.code ?? `SKU-${i + 1}`,
      name: p.name,
      description: p.description,
      category: null,
      status: 'active' as const,
      visibleToBot: true,
      botInstructions: p.instructions,
      imageUrls: [],
      ...(p.accommodation ? { accommodation: p.accommodation } : {}),
      variants: p.variants.map((v, j) => ({
        id: newId(),
        sku: v.sku ?? `SKU-${i + 1}-${j + 1}`,
        name: v.name,
        price: v.price,
        cost: 0,
        weightGram: 0,
        stock: [{ warehouseId: newId(), onHand: v.stock, reserved: 0, available: v.stock }],
      })),
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      available: p.variants.reduce((sum, v) => sum + v.stock, 0),
      createdAt: stamp,
      updatedAt: stamp,
    };
  });
}

/** The same `LlmRuntime` the api uses, on an in-memory config whose only provider answers with `reply`. */
export function fakeRuntime(replyFor: (c: EvalCase) => string, c: EvalCase): LlmRuntime {
  const provider = new FakeLlmProvider(DEV_FAKE_PROVIDER, () => ({ text: replyFor(c) }));
  const factory: LlmProviderFactory = {
    create: () => {
      throw new Error('fake mode has no configured providers');
    },
    hermesLogin: () => {
      throw new Error('not used');
    },
    listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
    developmentFallback: () => ({ provider, model: 'eval-fake' }),
  };
  return new LlmRuntime(new InMemoryLlmConfigRepository(), factory);
}

/** The model output a fake-mode case replays (its `expect.fake_reply`). */
export function fakeReplyText(c: EvalCase): string {
  const fake = c.expect.fake_reply;
  if (!fake) throw new Error(`case ${c.id} has no expect.fake_reply (needed in fake mode)`);
  return JSON.stringify(fake);
}

/** The production reply pipeline on in-memory facades built from the case. */
export function buildService(c: EvalCase, llm: LlmRuntime) {
  const botId = newId();
  const bot = botFor(c, botId);
  const faqHits: FaqHit[] = c.faqs.map((f) => ({
    id: newId(),
    botId,
    question: f.question,
    answer: f.answer,
    source: 'manual',
    updatedAt: new Date(0),
    score: 1,
  }));
  const stamp = new Date(0).toISOString();
  const scenarios: TrainingItemDto[] = c.situations.map((s, i) => ({
    id: newId(),
    botId,
    kind: 'scenario',
    title: s.title,
    trigger: s.trigger ?? '',
    content: s.content,
    notes: '',
    mediaUrl: null,
    folderId: null,
    enabled: true,
    section: s.section,
    createdAt: new Date(i * 1000).toISOString(),
    updatedAt: stamp,
  }));
  const products = productDtos(c);
  const runs = new InMemoryAiRunRepository();
  const service = new PlaygroundService(
    { getBot: async () => bot } as BotFacade,
    { searchFaqs: async () => faqHits } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Eval Shop' }) } as unknown as WorkspaceFacade,
    llm,
    runs,
    { list: async () => scenarios } as unknown as TrainingFacade,
    {
      searchBotCatalog: async () => products,
      getBotProductsByIds: async () => [],
      countBotCatalog: async () => products.length,
    } as unknown as CatalogFacade,
    { listForBot: async () => [] } as unknown as ActionFacade,
  );
  return { service, botId, runs };
}

const request = (c: EvalCase): PlaygroundRequest => ({
  messages: c.conversation.map((turn) =>
    'customer' in turn
      ? { role: 'customer' as const, content: turn.customer }
      : { role: 'bot' as const, content: turn.bot },
  ),
});

const customerTextsOf = (c: EvalCase): string[] =>
  c.conversation.flatMap((t) => ('customer' in t ? [t.customer] : []));

const errorResult = (c: EvalCase, error: string): CaseResult => ({
  id: c.id,
  group: c.group,
  tags: c.tags,
  critical: c.tags.includes('critical'),
  pass: false,
  checks: [],
  customer: customerTextsOf(c).at(-1) ?? '',
  reply: '',
  outcome: null,
  guardrail: null,
  promptVersion: null,
  provider: null,
  model: null,
  latencyMs: null,
  error,
});

/** Runs one case through `PlaygroundService.playground()` (prompt build, guardrails, post-processing) and checks it. */
export async function runCase(c: EvalCase, llm: LlmRuntime): Promise<CaseResult> {
  const customerTexts = customerTextsOf(c);
  const { service, botId, runs } = buildService(c, llm);
  try {
    const res = await service.playground(workspaceId(newId()), botId, request(c));
    const checks = runChecks(c.expect, {
      reply: res.reply,
      outcome: res.outcome,
      guardrail: res.guardrail,
      customerTexts,
      trusted: trustedTexts(c),
    });
    return {
      id: c.id,
      group: c.group,
      tags: c.tags,
      critical: c.tags.includes('critical'),
      customer: customerTexts.at(-1) ?? '',
      pass: checks.every((x) => x.pass),
      checks,
      reply: res.reply,
      outcome: res.outcome,
      guardrail: res.guardrail,
      promptVersion: runs.runs.at(-1)?.promptVersion ?? null,
      provider: res.provider,
      model: res.model,
      latencyMs: res.latencyMs,
      error: null,
    };
  } catch (error) {
    return errorResult(c, error instanceof Error ? error.message : String(error));
  }
}

/** Fake mode: the model answers with each case's `expect.fake_reply`; no network. */
export function runCaseFake(c: EvalCase): Promise<CaseResult> {
  if (!c.expect.fake_reply)
    return Promise.resolve(errorResult(c, 'expect.fake_reply is required in fake mode'));
  return runCase(c, fakeRuntime(fakeReplyText, c));
}
