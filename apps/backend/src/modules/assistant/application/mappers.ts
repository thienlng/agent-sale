import {
  AssistantUiAction,
  type AssistantMessageDto,
  type AssistantRunDto,
  type AssistantThreadDto,
} from '@agent-sales/contracts';

import type {
  MessageRecord,
  RunRecord,
  StepRecord,
  ThreadRecord,
} from '../domain/ports/assistant.repository.js';

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

/** Visible messages only: tool rows stay internal (ruling R1). */
export function toMessageDtos(messages: MessageRecord[]): AssistantMessageDto[] {
  return messages.flatMap((msg) =>
    msg.role === 'tool'
      ? []
      : [
          {
            id: msg.id,
            seq: msg.seq,
            role: msg.role,
            content: msg.content,
            uiActions: msg.uiActions.flatMap((a) => {
              const parsed = AssistantUiAction.safeParse(a);
              return parsed.success ? [parsed.data] : [];
            }),
            runId: msg.runId,
            createdAt: msg.createdAt.toISOString(),
          },
        ],
  );
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
