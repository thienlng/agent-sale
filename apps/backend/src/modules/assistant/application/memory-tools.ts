import { scanUntrustedText, type RunnableTool, type ToolDefinition } from '@agent-sales/ai-core';
import { newId } from '@agent-sales/shared';
import { z } from 'zod';

import {
  isLikelyDuplicate,
  isNearDuplicate,
  memoryContainment,
  normaliseMemoryText,
} from '../domain/memory-similarity.js';
import { isKnownStore, memoryLimit, memoryUsed } from '../domain/memory-store.js';
import { matchesTombstone, withoutTombstone } from '../domain/memory-tombstones.js';

export {
  isLikelyDuplicate,
  isNearDuplicate,
  normaliseMemoryText,
} from '../domain/memory-similarity.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type {
  AssistantRepository,
  MemoryEntry,
  MemoryOrigin,
  MessageRecord,
} from '../domain/ports/assistant.repository.js';
import { IMPORT_BLOCK_PREFIX } from './import-block.js';

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
    'When the owner asks to forget or stop using a fact, remove it (that applies at once); never replace it with a ' +
    'default. likely_duplicate: an entry already says this in other words; replace it instead. ' +
    'deleted_by_owner: the owner deleted that fact earlier: when the owner’s message in this turn asks you to ' +
    'remember it (nhớ giúp, ghi nhớ, lưu lại), retry at once with ownerAskedAgain: true; otherwise do not save it, ' +
    'reworded or split.',
  input: MemoryInput,
};

/**
 * The share of a fact's content words that must come from the owner's own message of the turn
 * for it to count as the owner's words (AS-8): the model adds framing ("xưng hô với chủ tài
 * khoản là") around what the owner typed, so not every word is theirs.
 */
export const OWNER_WORDED_SHARE = 0.6;

/** One turn's memory state: the failure count is per turn. */
export interface MemoryToolContext {
  scope: OwnerScope;
  repo: AssistantRepository;
  /** Who writes: the chat turn (`assistant`, the default) or the background review. */
  origin?: Extract<MemoryOrigin, 'assistant' | 'review'>;
  /**
   * True once the turn received tool output (see `taintOnToolOutput`): a new or rewritten
   * entry then waits for the owner's approval. A review write always waits.
   */
  tainted?: () => boolean;
  /**
   * The owner's own message of this turn. A fact whose content words mostly (OWNER_WORDED_SHARE) come from it was
   * worded by the owner, not by tool output, so it is saved without approval even in a tainted
   * turn (AS-8).
   */
  ownerText?: string;
}

/** Tools whose results carry no data from outside the owner's own words (UI actions only). */
const NO_DATA_TOOLS = new Set(['ui_navigate', 'ui_spotlight', 'ui_fill_form']);

/**
 * Sets `state.tainted` once any tool other than `memory` and the UI-only tools returned in this
 * turn: route reads, SQL, skills, session search and imports bring text the owner did not type
 * (customer messages, product names, documents), which may carry injected instructions. The
 * memory tool reads the flag, so a fact saved after such output waits for the owner's approval.
 */
export function taintOnToolOutput(
  tools: readonly RunnableTool[],
  state: { tainted: boolean },
): RunnableTool[] {
  return tools.map((tool) =>
    tool.name === MEMORY_TOOL || NO_DATA_TOOLS.has(tool.name)
      ? tool
      : {
          ...tool,
          async run(input) {
            try {
              return await tool.run(input);
            } finally {
              state.tainted = true;
            }
          },
        },
  );
}

/**
 * True when the replayed history already carries text the owner did not type: a data tool's
 * result from an earlier turn, an `<import_batch>` block, or a compaction summary (which may
 * restate such results). A turn starts tainted then, so "ok, save it" in turn N+1 cannot store
 * an instruction that a tool result planted in turn N as an approved memory (PR #173 review).
 */
export function historyIsTainted(
  history: readonly Pick<MessageRecord, 'role' | 'toolName' | 'content' | 'isSummary'>[],
): boolean {
  return history.some(
    (m) =>
      m.isSummary ||
      (m.role === 'tool' && !NO_DATA_TOOLS.has(m.toolName ?? '')) ||
      (m.role === 'user' && IMPORT_BLOCK_PREFIX.test(m.content)),
  );
}

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

/** One line, trimmed: an entry never spans lines in the prompt. */
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * A replaced entry. A write waiting for approval (every review rewrite) keeps the last approved
 * text and origin it replaced (across repeated rewrites while still waiting), so the prompt keeps
 * the approved text and undo gives it back; an approved write drops them.
 */
function replaced(
  e: MemoryEntry,
  text: string,
  origin: MemoryOrigin,
  updatedAt: string,
  pending: boolean,
): MemoryEntry {
  const { previousText, previousOrigin, previousPending, pending: _wasPending, ...rest } = e;
  if (!pending) return { ...rest, text, origin, updatedAt };
  const keep =
    e.pending && previousText !== undefined
      ? {
          previousText,
          previousOrigin: previousOrigin ?? 'assistant',
          ...(previousPending ? { previousPending } : {}),
        }
      : {
          previousText: e.text,
          previousOrigin: e.origin,
          ...(e.pending ? { previousPending: true as const } : {}),
        };
  return { ...rest, text, origin, updatedAt, ...keep, pending: true };
}

type Outcome =
  | {
      ok: true;
      message: string;
      used: number;
      limit: number;
      replaced?: string;
      awaitingOwnerApproval?: true;
    }
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
 * stamps `updatedAt`; a review replace keeps the previous text for undo). A write by the review,
 * or by a chat turn that already read tool output (`tainted`), is stored `pending`: it waits for
 * the owner's approval and stays out of every prompt until then (security audit #12). The text
 * is stored; it never reaches the logs.
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
          hint: 'the owner deleted this fact earlier: if their message in this turn asks you to remember it, retry now with ownerAskedAgain: true; otherwise do not save it, and do not reword or split it',
        };
      }
    }

    // A reworded entry with the same content words (QA DUP-2): rewrite it instead of adding.
    const similar = text
      ? entries.find((e) => e !== target && isLikelyDuplicate(e.text, text))
      : undefined;
    if (similar) {
      return {
        ok: false,
        errorCode: 'likely_duplicate',
        entries: [similar.text],
        hint: 'likely the same fact: replace that entry (match = a part of it) instead of adding',
      };
    }

    // Text that may come from tool output (or the review) never reaches a prompt unapproved.
    // The owner's own words in this turn are not tool output (AS-8).
    const ownerWorded =
      text !== undefined &&
      ctx.ownerText !== undefined &&
      memoryContainment(text, ctx.ownerText) >= OWNER_WORDED_SHARE;
    const pending = origin === 'review' || (ctx.tainted?.() === true && !ownerWorded);
    // A rewrite of an entry that still waits keeps waiting: only the owner's approval endpoint
    // approves, never a later untainted chat write (PR #173 review).
    const stillPending = pending || target?.pending === true;
    let next: MemoryEntry[];
    if (action === 'remove') {
      next = entries.filter((e) => e !== target);
    } else if (!text) {
      return { ok: false, errorCode: 'missing_text' }; // checked above; narrows the type
    } else if (action === 'add') {
      next = [
        ...entries,
        {
          id: newId(),
          text,
          origin,
          createdAt: new Date().toISOString(),
          ...(pending ? { pending: true as const } : {}),
        },
      ];
    } else {
      const updatedAt = new Date().toISOString();
      next = entries.map((e) =>
        e === target ? replaced(e, text, origin, updatedAt, stillPending) : e,
      );
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
    const waits = stillPending && action !== 'remove';
    return {
      ok: true,
      message: waits
        ? `${verb} in ${store} (${used}/${limit}), awaiting the owner's approval in Memory: it is not used until approved.`
        : action === 'remove'
          ? `Removed from ${store} (${used}/${limit}). It applies now: stop using it in this conversation too, even where your instructions above still show it.`
          : `${verb} in ${store} (${used}/${limit}).`,
      ...(waits ? { awaitingOwnerApproval: true as const } : {}),
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
