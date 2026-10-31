import { FakeLlmProvider, type GenerateRequest } from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto, TrainingItemDto } from '@agent-sales/contracts';
import { foldVietnamese, newId, workspaceId } from '@agent-sales/shared';

import type { ActionFacade } from '../../action/api/index.js';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { BotCatalogScope, CatalogFacade } from '../../commerce/api/index.js';
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
  /** Model calls of the turn (1 without tools; each tool round adds one). */
  modelCalls: number;
  /** Pictures sent with the reply. */
  images: number;
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
      // Stable ids: a fake reply names its pictures as `p:<product id>:<n>`.
      id: `eval-product-${i + 1}`,
      code: p.code ?? `SKU-${i + 1}`,
      name: p.name,
      description: p.description,
      category: null,
      status: 'active' as const,
      visibleToBot: true,
      botInstructions: p.instructions,
      imageUrls: p.images,
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

type FakeScript = (req: GenerateRequest) => {
  text: string;
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  stopReason?: 'tool_use';
};

const hasToolResult = (req: GenerateRequest): boolean =>
  req.messages.some((m) => m.role === 'tool');

/**
 * The fake model of a case: on its first call it makes the case's `fake_tool_calls` (or browses the
 * catalog when the case has products, so figures are grounded as in production), then it returns
 * `fake_reply`.
 */
export function fakeScript(c: EvalCase): FakeScript {
  const calls =
    c.expect.fake_tool_calls ??
    (c.products.length ? [{ name: 'search_products', arguments: {} }] : []);
  return (req) => {
    if (calls.length && !hasToolResult(req))
      return {
        text: '',
        stopReason: 'tool_use',
        toolCalls: calls.map((call, i) => ({
          id: `fake-call-${i + 1}`,
          name: call.name,
          input: call.arguments,
        })),
      };
    return { text: fakeReplyText(c) };
  };
}

/** The same `LlmRuntime` the api uses, on an in-memory config whose only provider is scripted by `script`. */
export function fakeRuntime(replyFor: (c: EvalCase) => string, c: EvalCase): LlmRuntime;
export function fakeRuntime(script: FakeScript): LlmRuntime;
export function fakeRuntime(
  first: ((c: EvalCase) => string) | FakeScript,
  c?: EvalCase,
): LlmRuntime {
  const script: FakeScript =
    c !== undefined
      ? () => ({ text: (first as (c: EvalCase) => string)(c) })
      : (first as FakeScript);
  const provider = new FakeLlmProvider(DEV_FAKE_PROVIDER, script);
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

const terms = (text: string): string[] =>
  [
    ...new Set(
      foldVietnamese(text)
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2),
    ),
  ].slice(0, 8);

/**
 * The in-memory catalog of a case. `search_products` ranks like a small search engine: accent-folded
 * terms of the query found in the name (weight 3), category or description, so a live model that
 * searches for a product by name finds it first. No query lists every product.
 */
export function evalCatalog(products: ProductDto[]): CatalogFacade {
  const visible = (_scope: BotCatalogScope) => products;
  return {
    searchBotCatalog: async (_ws, scope, input) => {
      let rows = visible(scope).filter(
        (p) =>
          (input.maxPriceVnd === undefined || p.priceMin <= input.maxPriceVnd) &&
          (!input.inStockOnly || p.available > 0),
      );
      const wanted = terms(input.query ?? '');
      if (wanted.length) {
        const score = (p: ProductDto): number => {
          const name = foldVietnamese(p.name);
          const rest = foldVietnamese(`${p.category ?? ''} ${p.description}`);
          return wanted.reduce(
            (sum, t) => sum + (name.includes(t) ? 3 : 0) + (rest.includes(t) ? 1 : 0),
            0,
          );
        };
        rows = rows
          .map((p, index) => ({ p, index, s: score(p) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || a.index - b.index)
          .map((x) => x.p);
      }
      return rows.slice(0, Math.min(input.limit, 300));
    },
    getBotProductsByIds: async (_ws, scope, ids) =>
      ids.flatMap((id) => visible(scope).filter((p) => p.id === id)).slice(0, 10),
    countBotCatalog: async (_ws, scope) => visible(scope).length,
  };
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
    evalCatalog(products as unknown as ProductDto[]),
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
  modelCalls: 0,
  images: 0,
  error,
});

/** Runs one case through `PlaygroundService.playground()` (prompt build, guardrails, post-processing) and checks it. */
export async function runCase(c: EvalCase, llm: LlmRuntime): Promise<CaseResult> {
  const customerTexts = customerTextsOf(c);
  const { service, botId, runs } = buildService(c, llm);
  // Count the model calls of the turn by wrapping the runtime the pipeline uses.
  const generate = llm.generate.bind(llm);
  let modelCalls = 0;
  llm.generate = (req) => {
    modelCalls += 1;
    return generate(req);
  };
  try {
    const res = await service.playground(workspaceId(newId()), botId, request(c));
    const checks = runChecks(c.expect, {
      reply: res.reply,
      outcome: res.outcome,
      guardrail: res.guardrail,
      images: res.images.length,
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
      modelCalls,
      images: res.images.length,
      error: null,
    };
  } catch (error) {
    return errorResult(c, error instanceof Error ? error.message : String(error));
  } finally {
    llm.generate = generate;
  }
}

/** Fake mode: the scripted model makes the case's tool calls, then answers with `expect.fake_reply`; no network. */
export function runCaseFake(c: EvalCase): Promise<CaseResult> {
  if (!c.expect.fake_reply)
    return Promise.resolve(errorResult(c, 'expect.fake_reply is required in fake mode'));
  return runCase(c, fakeRuntime(fakeScript(c)));
}
