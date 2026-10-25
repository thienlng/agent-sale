import type { ActionResponseField } from '@agent-sales/contracts';

/**
 * Reduces a JSON response to what the owner declared, so undeclared (possibly sensitive)
 * fields never reach the model. Pure.
 */
const MAX_STRING = 500;
const MAX_ITEMS = 10;
const MAX_DEPTH = 3;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Copies a value with limits; containers nested deeper than MAX_DEPTH become null. */
function limit(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return value.slice(0, MAX_STRING);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    if (depth > MAX_DEPTH) return null;
    return value.slice(0, MAX_ITEMS).map((v) => limit(v, depth + 1));
  }
  if (isRecord(value)) {
    if (depth > MAX_DEPTH) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) {
      if (!FORBIDDEN_KEYS.has(k)) out[k] = limit(v, depth + 1);
    }
    return out;
  }
  return null;
}

function matches(type: ActionResponseField['type'], v: unknown): boolean {
  if (type === 'array') return Array.isArray(v);
  if (type === 'object') return isRecord(v);
  return typeof v === type;
}

function pick(record: Record<string, unknown>, fields: ActionResponseField[]) {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (FORBIDDEN_KEYS.has(field.name) || !Object.hasOwn(record, field.name)) continue;
    const v = record[field.name];
    if (matches(field.type, v)) out[field.name] = limit(v, 1);
  }
  return out;
}

export function trimResponse(json: unknown, fields: ActionResponseField[]): unknown {
  if (Array.isArray(json)) {
    return json.slice(0, MAX_ITEMS).map((row) => (isRecord(row) ? pick(row, fields) : null));
  }
  return isRecord(json) ? pick(json, fields) : null;
}
