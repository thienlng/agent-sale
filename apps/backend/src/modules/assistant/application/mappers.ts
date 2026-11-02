import type { SkillDoc } from '@agent-sales/ai-core';
import {
  AssistantUiAction,
  type AssistantMessageDto,
  type AssistantRunDto,
  type AssistantSkillDto,
  type AssistantSkillEventDto,
  type AssistantSkillSummaryDto,
  type AssistantThreadDto,
} from '@agent-sales/contracts';

import type {
  MessageRecord,
  RunRecord,
  SkillEventRecord,
  SkillRecord,
  StepRecord,
  ThreadRecord,
} from '../domain/ports/assistant.repository.js';
import { IMPORT_BLOCK_PREFIX } from './import-block.js';

export function toThreadDto(t: ThreadRecord): AssistantThreadDto {
  return {
    id: t.id,
    title: t.title,
    pinned: t.pinned,
    archived: t.archived,
    businessId: t.businessId,
    lastMessageAt: t.lastMessageAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Whether the owner sees a message: tool rows stay internal (ruling R1), and so does an
 * assistant row that only asked for tools (no text of its own) and a compaction summary (it is
 * for the model only, ruling 1b-R9).
 */
export function isVisibleMessage(msg: MessageRecord): boolean {
  if (msg.role === 'tool' || msg.isSummary) return false;
  return !(msg.role === 'assistant' && msg.toolCalls?.length && !msg.content.trim());
}

/** Visible messages only (see `isVisibleMessage`). */
export function toMessageDtos(messages: MessageRecord[]): AssistantMessageDto[] {
  return messages.filter(isVisibleMessage).map((msg) => ({
    id: msg.id,
    seq: msg.seq,
    role: msg.role as AssistantMessageDto['role'],
    // An import message's `<import_batch>` block is for the model only.
    content: msg.role === 'user' ? msg.content.replace(IMPORT_BLOCK_PREFIX, '') : msg.content,
    uiActions: msg.uiActions.flatMap((a) => {
      const parsed = AssistantUiAction.safeParse(a);
      return parsed.success ? [parsed.data] : [];
    }),
    runId: msg.runId,
    createdAt: msg.createdAt.toISOString(),
  }));
}

export function toRunDto(run: RunRecord & { steps: StepRecord[] }): AssistantRunDto {
  return {
    id: run.id,
    status: run.status,
    outcome: run.outcome,
    rounds: run.rounds,
    latencyMs: run.latencyMs,
    steps: run.steps.map((s) => ({
      idx: s.idx,
      kind: s.kind,
      toolName: s.toolName,
      ok: s.ok,
      ms: s.ms,
      errorCode: s.errorCode,
    })),
  };
}

/** `platform:<name>`: how a platform skill (a file, no row) is referred to. */
export const PLATFORM_SKILL_REF = 'platform:';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** A platform skill on the skills page: always active, no counters. */
export function toPlatformSkillSummary(
  doc: Pick<SkillDoc, 'name' | 'description'>,
  shadowed: boolean,
): AssistantSkillSummaryDto {
  return {
    ref: `${PLATFORM_SKILL_REF}${doc.name}`,
    id: null,
    name: doc.name,
    description: doc.description,
    provenance: 'platform',
    shadowOf: null,
    shadowed,
    state: 'active',
    pinned: false,
    useCount: 0,
    viewCount: 0,
    patchCount: 0,
    lastUsedAt: null,
    lastPatchedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

export function toPlatformSkillDto(doc: SkillDoc, shadowed: boolean): AssistantSkillDto {
  return { ...toPlatformSkillSummary(doc, shadowed), body: doc.body, toolsets: doc.toolsets };
}

export function toSkillSummary(x: SkillRecord): AssistantSkillSummaryDto {
  return {
    ref: x.id,
    id: x.id,
    name: x.name,
    description: x.description,
    provenance: x.provenance,
    shadowOf: x.shadowOf,
    shadowed: false,
    state: x.state,
    pinned: x.pinned,
    useCount: x.useCount,
    viewCount: x.viewCount,
    patchCount: x.patchCount,
    lastUsedAt: iso(x.lastUsedAt),
    lastPatchedAt: iso(x.lastPatchedAt),
    createdAt: x.createdAt.toISOString(),
    updatedAt: x.updatedAt.toISOString(),
  };
}

export function toSkillDto(x: SkillRecord): AssistantSkillDto {
  return { ...toSkillSummary(x), body: x.body, toolsets: x.toolsets };
}

export function toSkillEventDto(e: SkillEventRecord): AssistantSkillEventDto {
  return {
    id: e.id,
    skillId: e.skillId,
    actor: e.actor,
    action: e.action,
    before: e.before,
    after: e.after,
    undoneAt: iso(e.undoneAt),
    createdAt: e.createdAt.toISOString(),
  };
}
