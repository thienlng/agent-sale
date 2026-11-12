import { PROMPTS_DIR, PromptRegistry, scanUntrustedText } from '@agent-sales/ai-core';
import { newId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import type { Logger } from '@nestjs/common';

import type { LlmGatewayPort } from '../../ai/api/index.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { AssistantRepository, ScheduleRecord } from '../domain/ports/assistant.repository.js';
import type { ComputedReport } from './report.service.js';

/** The commentary call is one tier-`basic` call cut after this (S3-R2). */
export const COMMENTARY_TIER = 'basic' as const;
export const COMMENTARY_TIMEOUT_MS = 30_000;
export const COMMENTARY_MAX_CHARS = 600;
export const COMMENTARY_PROMPT = { name: 'assistant-schedule-commentary', version: 2 } as const;

const registry = new PromptRegistry(PROMPTS_DIR);
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * One tier-`basic` call over the report JSON only (no PII by S3-R9), recorded as a `schedule`
 * run. Cut at 600 chars; dropped when it fails the safety scan; any error is logged and the
 * report goes out without it (S3-R18).
 */
export async function writeCommentary(
  deps: { repo: AssistantRepository; gateway: LlmGatewayPort; log: Logger },
  s: ScheduleRecord,
  computed: ComputedReport,
): Promise<{ text: string | null; runId: string | null }> {
  const runId = newId();
  const scope: OwnerScope = {
    accountId: s.accountId,
    ownerUserId: s.ownerUserId as UserId,
    businessId: s.businessId as WorkspaceId,
    businessIds: [s.businessId as WorkspaceId],
  };
  const started = Date.now();
  const record = (r: {
    status: 'done' | 'failed';
    outcome?: string | null;
    guardrail?: string | null;
    provider?: string | null;
    model?: string | null;
    inputTokens?: number;
    cachedTokens?: number;
    outputTokens?: number;
  }) =>
    deps.repo
      .recordRun(scope, {
        id: runId,
        threadId: null,
        kind: 'schedule',
        tier: COMMENTARY_TIER,
        promptVersion: `${COMMENTARY_PROMPT.name}@${COMMENTARY_PROMPT.version}`,
        provider: r.provider ?? null,
        model: r.model ?? null,
        inputTokens: r.inputTokens ?? 0,
        cachedTokens: r.cachedTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        latencyMs: Date.now() - started,
        rounds: 1,
        outcome: r.outcome ?? null,
        guardrail: r.guardrail ?? null,
        status: r.status,
      })
      .then(() => runId)
      .catch((e: unknown) => {
        deps.log.warn(`schedule ${s.id}: commentary run not saved (${errorClass(e)})`);
        return null;
      });
  try {
    const system = await registry.load(COMMENTARY_PROMPT);
    const res = await deps.gateway.generate({
      workspaceId: s.businessId as WorkspaceId,
      tier: COMMENTARY_TIER,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(computed.result) },
      ],
      maxOutputTokens: 400,
      timeoutMs: COMMENTARY_TIMEOUT_MS,
      signal: AbortSignal.timeout(COMMENTARY_TIMEOUT_MS),
    });
    const text = Array.from(res.text.trim()).slice(0, COMMENTARY_MAX_CHARS).join('').trim();
    const safe = text.length > 0 && scanUntrustedText(text).ok;
    const usage = {
      provider: res.provider,
      model: res.model,
      inputTokens: res.usage.inputTokens,
      cachedTokens: res.usage.cachedInputTokens,
      outputTokens: res.usage.outputTokens,
    };
    const saved = await record(
      safe
        ? { status: 'done', outcome: 'done', ...usage }
        : { status: 'failed', outcome: 'dropped', guardrail: 'unsafe_commentary', ...usage },
    );
    return { text: safe ? text : null, runId: saved };
  } catch (e) {
    deps.log.warn(`schedule ${s.id}: commentary skipped (${errorClass(e)})`);
    return { text: null, runId: await record({ status: 'failed', guardrail: 'model_error' }) };
  }
}
