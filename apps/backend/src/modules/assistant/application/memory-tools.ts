import { scanUntrustedText, type RunnableTool, type ToolDefinition } from '@agent-sales/ai-core';
import { newId } from '@agent-sales/shared';
import { z } from 'zod';

import { isNearDuplicate, normaliseMemoryText } from '../domain/memory-similarity.js';
import { isKnownStore, memoryLimit, memoryUsed } from '../domain/memory-store.js';
import { matchesTombstone, withoutTombstone } from '../domain/memory-tombstones.js';

export { isNearDuplicate, normaliseMemoryText } from '../domain/memory-similarity.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type {
  AssistantRepository,
  MemoryEntry,
  MemoryOrigin,
} from '../domain/ports/assistant.repository.js';

export const MEMORY_TOOL = 'memory';
/** After this many failed memory calls in one turn, every further call answers `stop_retrying`. */
export const MEMORY_MAX_FAILURES = 3;
/** Appended to `store_full` so the model cleans up instead of retrying the same add. */
export const CONSOLIDATE_HINT = 'consolidate: replace or remove entries first';

const MemoryInput = z.object({
  action: z.enum(['add', 'replace', 'remove']),
  store: z.string(),
  text: z.string().max(1000).optional(),
  match: z.string().max(200).optional(),
  ownerAskedAgain: z.boolean().optional(),
});

export const MEMORY_TOOL_DEFINITION: ToolDefinition = {
  name: MEMORY_TOOL,
  description:
    'Save, change or remove a lasting fact. store: owner_profile (who the owner is, how they want answers), ' +
    'notes (how they run the shops) or business:<businessId>. add needs text; replace needs match ' +
    '(a unique part of one entry) and text, and rewrites only that entry: use it when the new text corrects or ' +
    'supersedes that same fact, never to save a different one (a new preference is an add; the replaced ' +
    'entry is gone). remove needs match. Facts only, never instructions or customer data. ' +
    'deleted_by_owner: the owner deleted that fact, so do not save it; only when the owner asks in this ' +
    'turn to remember it again, retry with ownerAskedAgain: true.',
  input: MemoryInput,
};

/** One turn's memory state: the failure count is per turn. */
export interface MemoryToolContext {
  scope: OwnerScope;
  repo: AssistantRepository;
  /** Who writes: the chat turn (`assistant`, the default) or the background review. */
  origin?: Extract<MemoryOrigin, 'assistant' | 'review'>;
}

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

/** One line, trimmed: an entry never spans lines in the prompt. */
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * A replaced entry. A review rewrite keeps the text and origin it replaced (the first ones,
 * across repeated review rewrites), so undo gives the owner their text back; any other write
 * drops them.
 */
function replaced(
  e: MemoryEntry,
  text: string,
  origin: MemoryOrigin,
  updatedAt: string,
): MemoryEntry {
  const { previousText, previousOrigin, ...rest } = e;
  if (origin !== 'review') return { ...rest, text, origin, updatedAt };
  const keep =
    e.origin === 'review' && previousText !== undefined
      ? { previousText, previousOrigin: previousOrigin ?? 'assistant' }
      : { previousText: e.text, previousOrigin: e.origin };
  return { ...rest, text, origin, updatedAt, ...keep };
}

type Outcome =
  | { ok: true; message: string; used: number; limit: number; replaced?: string }
  | {
      ok: false;
      errorCode: string;
      entries?: string[];
      hint?: string;
      used?: number;
      limit?: number;
    };

/**
 * The `memory` tool for one turn (spec §10): bounded stores, near-duplicates refused, every
 * new text scanned (`unsafe:<issues>`), `match` must hit exactly one entry. A full store answers
 * `store_full` with the entries and a consolidate hint. After 3 failed calls in the turn the tool
 * answers `stop_retrying`. A new or replaced entry takes the context's `origin` (a replace also
 * stamps `updatedAt`; a review replace keeps the previous text for undo). The text is stored; it never reaches the logs.
 */
export function memoryTool(ctx: MemoryToolContext): RunnableTool {
  let failures = 0;
  const origin = ctx.origin ?? 'assistant';

  async function apply(input: z.output<typeof MemoryInput>): Promise<Outcome> {
    const { action, store } = input;
    if (!isKnownStore(store, ctx.scope.businessIds))
      return { ok: false, errorCode: 'unknown_store' };
    const text = input.text === undefined ? undefined : clean(input.text);
    const match = input.match?.trim();
    if (action !== 'remove' && !text) return { ok: false, errorCode: 'missing_text' };
    if (action !== 'add' && !match) return { ok: false, errorCode: 'missing_match' };
    if (text) {
      const scan = scanUntrustedText(text);
      if (!scan.ok) return { ok: false, errorCode: `unsafe:${scan.issues.join(',')}` };
    }

    const memory = await ctx.repo.getMemory(ctx.scope);
    const current = memory.find((m) => m.store === store);
    const entries = current?.entries ?? [];
    const limit = memoryLimit(store);

    let target: MemoryEntry | undefined;
    if (match) {
      const hits = entries.filter((e) => e.text.includes(match));
      if (hits.length === 0) return { ok: false, errorCode: 'match_not_found' };
      if (hits.length > 1) return { ok: false, errorCode: 'match_not_unique' };
      target = hits[0];
    }
    // Near-duplicates too (case, spaces, diacritics, one inside the other); a replace may grow
    // the entry it rewrites.
    const same = text
      ? entries.find((e) =>
          e === target
            ? normaliseMemoryText(e.text) === normaliseMemoryText(text)
            : isNearDuplicate(e.text, text),
        )
      : undefined;
    if (same) {
      return {
        ok: false,
        errorCode: 'duplicate',
        entries: [same.text],
        hint: 'already saved: keep it, or replace that entry to change it',
      };
    }

    // The owner deleted this fact (QA NB-4): only the chat, on the owner's explicit ask, may
    // save it again; the review never does.
    const again = origin === 'assistant' && input.ownerAskedAgain === true;
    if (text && action !== 'remove' && !again) {
      if (memory.some((m) => matchesTombstone(m.tombstones, text))) {
        return {
          ok: false,
          errorCode: 'deleted_by_owner',
          hint: 'the owner deleted this fact: do not save it unless they ask to remember it again',
        };
      }
    }

    let next: MemoryEntry[];
    if (action === 'remove') {
      next = entries.filter((e) => e !== target);
    } else if (!text) {
      return { ok: false, errorCode: 'missing_text' }; // checked above; narrows the type
    } else if (action === 'add') {
      next = [...entries, { id: newId(), text, origin, createdAt: new Date().toISOString() }];
    } else {
      const updatedAt = new Date().toISOString();
      next = entries.map((e) => (e === target ? replaced(e, text, origin, updatedAt) : e));
    }

    const used = memoryUsed(next);
    if (used > limit) {
      return {
        ok: false,
        errorCode: 'store_full',
        entries: entries.map((e) => e.text),
        hint: CONSOLIDATE_HINT,
        used: memoryUsed(entries),
        limit,
      };
    }
    const tombstones =
      again && text && matchesTombstone(current?.tombstones, text)
        ? withoutTombstone(current?.tombstones, text)
        : undefined;
    await ctx.repo.saveMemoryStore(ctx.scope, store, next, tombstones);
    const verb = action === 'add' ? 'Saved' : action === 'replace' ? 'Replaced' : 'Removed';
    return {
      ok: true,
      message: `${verb} in ${store} (${used}/${limit}).`,
      used,
      limit,
      // What a replace overwrote, so a wrong target is visible and can be added back.
      ...(action === 'replace' && target ? { replaced: target.text } : {}),
    };
  }

  return {
    name: MEMORY_TOOL,
    readOnly: false,
    schema: MemoryInput,
    async run(input) {
      if (failures >= MEMORY_MAX_FAILURES) {
        return { content: json({ ok: false, errorCode: 'stop_retrying' }), ok: false };
      }
      const out = await apply(input as z.output<typeof MemoryInput>);
      if (!out.ok) failures++;
      return out.ok ? { content: json(out) } : { content: json(out), ok: false };
    },
  };
}
