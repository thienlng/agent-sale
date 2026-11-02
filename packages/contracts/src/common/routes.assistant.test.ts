import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { allRoutes } from '../index.js';
import { routeKey, type RouteContract } from './routes.js';

/** A body property named like this can carry a secret (T-174, spec C5 §7.1). */
const SECRET_KEY = /secret|password|token|api_?key|credential/i;

const toJson = (schema: z.ZodType): JsonNode =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonNode;

/** Every object node of a body schema, at any depth (properties, array items, unions, intersections). */
function objectNodes(schema: z.ZodType): JsonNode[] {
  const nodes: JsonNode[] = [];
  const seen = new Set<JsonNode>();
  const walk = (node: JsonNode | undefined): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.properties) nodes.push(node);
    for (const sub of Object.values(node.properties ?? {})) walk(sub);
    const items = Array.isArray(node.items) ? node.items : node.items ? [node.items] : [];
    for (const sub of [
      ...items,
      ...(node.anyOf ?? []),
      ...(node.oneOf ?? []),
      ...(node.allOf ?? []),
    ])
      walk(sub);
    for (const sub of Object.values(node.$defs ?? {})) walk(sub);
    if (node.additionalProperties && typeof node.additionalProperties === 'object')
      walk(node.additionalProperties);
  };
  walk(toJson(schema));
  return nodes;
}

/** The property names of a body schema at any depth. */
const allKeys = (schema: z.ZodType): string[] => [
  ...new Set(objectNodes(schema).flatMap((n) => Object.keys(n.properties ?? {}))),
];

interface JsonNode {
  properties?: Record<string, JsonNode>;
  items?: JsonNode | JsonNode[];
  additionalProperties?: boolean | JsonNode;
  anyOf?: JsonNode[];
  oneOf?: JsonNode[];
  allOf?: JsonNode[];
  $defs?: Record<string, JsonNode>;
}

/**
 * A valid assistant body per secret-bearing `write` route: the guard adds each secret-like key
 * to it and expects the narrowed body to reject the result.
 */
const VALID_ASSISTANT_BODIES: Record<string, Record<string, unknown>> = {
  'POST /bots/{botId}/actions': {
    name: 'Tra cứu đơn hàng',
    description: 'Gọi khi khách hỏi tình trạng đơn và đã cho mã đơn.',
    url: 'https://shop.example.com/api/orders/{orderCode}',
    method: 'GET',
    params: [
      {
        name: 'orderCode',
        type: 'string',
        location: 'path',
        required: true,
        description: 'Mã đơn hàng',
      },
    ],
    responses: [{ statusCode: 200, fields: [] }],
    auth: { kind: 'bearer' },
    requiresConfirm: false,
    enabled: false,
  },
};

/** A copy of `value` with `key: 'x'` added to every nested object (not the top level). */
function injectEverywhere(value: unknown, key: string, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((v) => injectEverywhere(v, key, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = injectEverywhere(v, key, depth + 1);
    if (depth > 0) out[key] = 'x';
    return out;
  }
  return value;
}

/**
 * Architecture test for the owner assistant (T-170): every workspace-scoped
 * route declares whether the assistant may read it, propose writes to it, or
 * never touch it. A new route without a ruling fails here.
 */
const routes: readonly RouteContract[] = allRoutes;
const scoped = routes.filter((r) => r.workspaceScoped);

describe('route assistant annotations', () => {
  it('declares `assistant` on every workspace-scoped route', () => {
    const missing = scoped.filter((r) => !r.assistant).map(routeKey);
    expect(missing).toEqual([]);
  });

  it('gives every read/write route a non-empty `when` of at most 160 chars', () => {
    const bad = scoped
      .filter((r) => r.assistant && r.assistant.use !== 'never')
      .filter((r) => {
        const when = r.assistant?.when?.trim() ?? '';
        return when.length === 0 || when.length > 160;
      })
      .map(routeKey);
    expect(bad).toEqual([]);
  });

  it('only marks GET routes, or POST routes flagged `queryPost`, as `read`', () => {
    const bad = routes.filter(
      (r) =>
        r.assistant?.use === 'read' &&
        r.method !== 'get' &&
        !(r.method === 'post' && r.assistant.queryPost),
    );
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('flags `queryPost` only on POST routes marked `read`', () => {
    const bad = routes.filter(
      (r) => r.assistant?.queryPost && (r.method !== 'post' || r.assistant.use !== 'read'),
    );
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('never marks a GET route as `write`', () => {
    const bad = routes.filter((r) => r.assistant?.use === 'write' && r.method === 'get');
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('never lets the assistant read or write a route that is not workspace-scoped', () => {
    const bad = routes.filter(
      (r) => !r.workspaceScoped && r.assistant !== undefined && r.assistant.use !== 'never',
    );
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('reads the side-effect-free query POSTs (ruling 1b-R7)', () => {
    const queryPosts = routes.filter((r) => r.assistant?.queryPost).map(routeKey);
    expect(queryPosts.sort()).toEqual(
      [
        'POST /analytics/drilldown',
        'POST /analytics/query',
        'POST /contacts/query',
        'POST /lodging/availability',
        'POST /lodging/quote',
        'POST /stay-requests/quote',
      ].sort(),
    );
  });

  it('never lets the assistant use /assistant or /auth routes', () => {
    const bad = routes.filter(
      (r) =>
        (r.path.startsWith('/assistant') || r.path.startsWith('/auth')) &&
        r.assistant !== undefined &&
        r.assistant.use !== 'never',
    );
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('lets a secret-bearing route be a `write` only through a narrowed body that rejects the secret', () => {
    // Secret-named keys are looked for at every depth, not only at the top level (`auth.token`).
    const problems: string[] = [];
    for (const r of routes) {
      if (r.assistant?.use !== 'write' || !r.body) continue;
      const secretKeys = allKeys(r.body).filter((k) => SECRET_KEY.test(k));
      if (secretKeys.length === 0) continue;
      const key = routeKey(r);
      const narrowed = r.assistant.body;
      if (!narrowed) {
        problems.push(`${key}: declare assistant.body without ${secretKeys.join(', ')}`);
        continue;
      }
      const left = allKeys(narrowed).filter((k) => SECRET_KEY.test(k));
      if (left.length) problems.push(`${key}: assistant.body still has ${left.join(', ')}`);
      // Strict at every depth, so a nested secret key is rejected instead of stored.
      if (objectNodes(narrowed).some((n) => n.additionalProperties !== false)) {
        problems.push(`${key}: assistant.body is not strict at every depth`);
      }
      const sample = VALID_ASSISTANT_BODIES[key];
      if (!sample) {
        problems.push(`${key}: add a sample to VALID_ASSISTANT_BODIES`);
        continue;
      }
      if (!narrowed.safeParse(sample).success) problems.push(`${key}: the sample is not valid`);
      for (const secret of secretKeys) {
        if (narrowed.safeParse({ ...sample, [secret]: 'x' }).success) {
          problems.push(`${key}: assistant.body accepts ${secret}`);
        }
        // The same key nested in every object of the sample.
        const nested = injectEverywhere(sample, secret);
        if (narrowed.safeParse(nested).success) {
          problems.push(`${key}: assistant.body accepts a nested ${secret}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('declares assistant.body only on `write` routes with a body', () => {
    const bad = routes.filter((r) => r.assistant?.body && (r.assistant.use !== 'write' || !r.body));
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('keeps every other action route away from the assistant', () => {
    const actionRoutes = routes.filter((r) => r.path.startsWith('/bots/{botId}/actions'));
    const uses = Object.fromEntries(actionRoutes.map((r) => [routeKey(r), r.assistant?.use]));
    expect(uses).toEqual({
      'GET /bots/{botId}/actions': 'read',
      'POST /bots/{botId}/actions': 'write',
      'POST /bots/{botId}/actions/test': 'never',
      'GET /bots/{botId}/actions/{actionId}': 'read',
      'PATCH /bots/{botId}/actions/{actionId}': 'never',
      'DELETE /bots/{botId}/actions/{actionId}': 'never',
      'POST /bots/{botId}/actions/{actionId}/test': 'never',
    });
  });

  it('builds route keys as `METHOD /path`', () => {
    expect(routeKey({ method: 'patch', path: '/products/{id}' })).toBe('PATCH /products/{id}');
  });
});
