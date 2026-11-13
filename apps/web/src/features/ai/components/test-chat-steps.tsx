import type { PlaygroundResponse } from '@agent-sales/contracts';
import { useState } from 'react';

import {
  RunTrace,
  RunTraceBox,
  RunTraceToggle,
  type TraceStep,
  type TraceSummary,
} from '@/components/run-trace';

/**
 * Under a bot answer, like the owner assistant's: "Xem các bước" with the model, total tokens and
 * time, opening the run summary and each step (tokens per model call, arguments and result head
 * per tool) in the shared trace format.
 */
export function TestChatSteps({ result }: { result: PlaygroundResponse }) {
  const [open, setOpen] = useState(false);
  const u = result.usage;
  const steps: TraceStep[] = (result.steps ?? []).map((s, idx) => ({
    idx,
    kind: s.kind,
    name: s.name ?? null,
    ok: s.ok ?? null,
    errorCode: s.errorCode ?? null,
    ms: s.ms ?? null,
    detail: (s.detail as Record<string, unknown> | null | undefined) ?? null,
  }));
  const summary: TraceSummary = {
    provider: result.provider,
    model: result.model,
    tier: result.tier ?? null,
    tokens: { input: u.inputTokens, cached: u.cachedInputTokens, output: u.outputTokens },
    status: result.outcome,
    rounds: result.rounds ?? null,
    latencyMs: result.latencyMs,
    guardrail: result.guardrail,
    runId: result.runId,
  };
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1">
      <RunTraceToggle
        open={open}
        onToggle={() => setOpen((v) => !v)}
        meta={{
          model: result.model,
          tokens: u.inputTokens + u.cachedInputTokens + u.outputTokens,
          latencyMs: result.latencyMs,
        }}
      />
      {open ? (
        <RunTraceBox>
          <RunTrace summary={summary} steps={steps} />
        </RunTraceBox>
      ) : null}
    </div>
  );
}
