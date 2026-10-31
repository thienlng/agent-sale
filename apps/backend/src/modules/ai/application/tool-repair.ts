import { INVALID_JSON_INPUT_KEY } from '@agent-sales/ai-core';

const MAX_NAME_DISTANCE = 2;

const squash = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/**
 * Maps a tool name the model produced onto one of the turn's tools (Hermes name repair):
 * exact, case-insensitive, `-`/space ↔ `_`, then a unique match within Levenshtein 2.
 * Returns null when nothing (or more than one candidate) matches.
 */
export function repairToolName(name: string, known: readonly string[]): string | null {
  if (known.includes(name)) return name;
  const lower = name.trim().toLowerCase();
  const ci = known.filter((k) => k.toLowerCase() === lower);
  if (ci.length === 1) return ci[0] ?? null;
  const squashed = squash(name);
  const sq = known.filter((k) => squash(k) === squashed);
  if (sq.length === 1) return sq[0] ?? null;
  const near = known.filter((k) => levenshtein(squash(k), squashed) <= MAX_NAME_DISTANCE);
  return near.length === 1 ? (near[0] ?? null) : null;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

/** Rewrites single quotes, unquoted keys and trailing commas into strict JSON. */
function relaxedToJson(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i] as string;
    if (ch === '"' || ch === "'") {
      let s = '"';
      i += 1;
      while (i < n && src[i] !== ch) {
        const c = src[i] as string;
        if (c === '\\' && i + 1 < n) {
          const next = src[i + 1] as string;
          s += next === "'" ? "'" : c + next;
          i += 2;
          continue;
        }
        s += c === '"' ? '\\"' : c;
        i += 1;
      }
      out += s + '"';
      i += 1;
    } else if (ch === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(src[j] as string)) j += 1;
      if (src[j] !== '}' && src[j] !== ']') out += ',';
      i += 1;
    } else if (IDENT_START.test(ch)) {
      let j = i;
      while (j < n && IDENT_PART.test(src[j] as string)) j += 1;
      const word = src.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(src[k] as string)) k += 1;
      out += src[k] === ':' ? `"${word}"` : word;
      i = j;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function stripFences(raw: string): string {
  const m = /^```[\w-]*\s*([\s\S]*?)\s*```$/.exec(raw.trim());
  return (m ? (m[1] ?? '') : raw).trim();
}

function parseLoose(raw: string): { ok: true; value: unknown } | { ok: false } {
  const text = stripFences(raw);
  if (text === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // fall through to the relaxed parse
  }
  try {
    return { ok: true, value: JSON.parse(relaxedToJson(text)) };
  } catch {
    return { ok: false };
  }
}

/**
 * Turns the arguments of a tool call into a value to validate. Strings are parsed (with fence,
 * trailing-comma, single-quote and unquoted-key repair); the provider's invalid-JSON marker is
 * retried on its raw string when it carries one. The detail never contains argument values.
 */
export function repairArguments(
  input: unknown,
): { ok: true; value: unknown } | { ok: false; detail: string } {
  const fail = { ok: false as const, detail: 'arguments are not valid JSON' };
  let raw: string | undefined;
  if (typeof input === 'string') raw = input;
  else if (typeof input === 'object' && input !== null && INVALID_JSON_INPUT_KEY in input) {
    const marked = (input as Record<string, unknown>)[INVALID_JSON_INPUT_KEY];
    if (typeof marked !== 'string') return fail;
    raw = marked;
  }
  if (raw === undefined) return { ok: true, value: input };
  const parsed = parseLoose(raw);
  return parsed.ok ? parsed : fail;
}
