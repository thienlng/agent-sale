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

interface FieldNode {
  type?: ActionResponseField['type'];
  children: Map<string, FieldNode>;
}

/** `items.code` declares `code` inside every element of `items`; `items` itself then stays a container. */
function buildTree(fields: ActionResponseField[]): Map<string, FieldNode> {
  const root = new Map<string, FieldNode>();
  for (const field of fields) {
    const path = field.name.split('.');
    if (path.length > MAX_DEPTH || path.some((s) => s === '' || FORBIDDEN_KEYS.has(s))) continue;
    let level = root;
    path.forEach((segment, i) => {
      const node: FieldNode = level.get(segment) ?? { children: new Map() };
      if (i === path.length - 1) node.type = field.type;
      level.set(segment, node);
      level = node.children;
    });
  }
  return root;
}

function pick(record: Record<string, unknown>, nodes: Map<string, FieldNode>, depth: number) {
  const out: Record<string, unknown> = {};
  for (const [name, node] of nodes) {
    if (!Object.hasOwn(record, name)) continue;
    const v = record[name];
    if (node.children.size === 0) {
      if (node.type && matches(node.type, v)) out[name] = limit(v, depth);
    } else if (Array.isArray(v) && (!node.type || node.type === 'array')) {
      out[name] = v
        .slice(0, MAX_ITEMS)
        .flatMap((row) => (isRecord(row) ? [pick(row, node.children, depth + 1)] : []));
    } else if (isRecord(v) && (!node.type || node.type === 'object')) {
      out[name] = pick(v, node.children, depth + 1);
    }
  }
  return out;
}

/** Top-level rows; a field whose literal key contains a dot (declared before paths existed) still matches. */
function pickRow(
  record: Record<string, unknown>,
  tree: Map<string, FieldNode>,
  fields: ActionResponseField[],
) {
  const out = pick(record, tree, 1);
  for (const field of fields) {
    if (
      field.name.includes('.') &&
      !FORBIDDEN_KEYS.has(field.name) &&
      Object.hasOwn(record, field.name) &&
      matches(field.type, record[field.name])
    )
      out[field.name] = limit(record[field.name], 1);
  }
  return out;
}

export function trimResponse(json: unknown, fields: ActionResponseField[]): unknown {
  const tree = buildTree(fields);
  if (Array.isArray(json)) {
    return json
      .slice(0, MAX_ITEMS)
      .map((row) => (isRecord(row) ? pickRow(row, tree, fields) : null));
  }
  return isRecord(json) ? pickRow(json, tree, fields) : null;
}
