import { z } from 'zod';

import { ErrorResponse } from './errors.js';

/**
 * Route contracts: the single source for the OpenAPI document and for the
 * backend-vs-contract consistency test. Every HTTP route under /api/v1 must be
 * declared here (per module file) — the backend test fails otherwise.
 */
export interface RouteContract {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  /** OpenAPI-style path relative to /api/v1, e.g. `/workspaces/{id}`. */
  path: string;
  summary: string;
  tag: string;
  /** Requires `Authorization: Bearer` (and workspace membership when `workspaceScoped`). */
  auth: boolean;
  workspaceScoped?: boolean;
  body?: z.ZodType;
  query?: z.ZodObject;
  /** Success responses by status code. */
  responses: Record<number, z.ZodType | null>;
}

export function defineRoutes<const T extends readonly RouteContract[]>(routes: T): T {
  return routes;
}

function schemaOf(s: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s, {
    io: 'output',
    unrepresentable: 'any',
  });
  return rest;
}

function inputSchemaOf(s: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });
  return rest;
}

/** Builds an OpenAPI 3.1 document from route contracts. */
export function buildOpenApiDocument(
  routes: readonly RouteContract[],
  info: { title: string; version: string },
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const errorSchema = schemaOf(ErrorResponse);
  for (const r of routes) {
    const parameters: unknown[] = [];
    for (const m of r.path.matchAll(/\{(\w+)\}/g)) {
      parameters.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } });
    }
    if (r.query) {
      const shape = r.query.shape as Record<string, z.ZodType>;
      for (const [name, s] of Object.entries(shape)) {
        parameters.push({
          name,
          in: 'query',
          required: !s.safeParse(undefined).success,
          schema: inputSchemaOf(s),
        });
      }
    }
    if (r.workspaceScoped) {
      parameters.push({
        name: 'X-Workspace-Id',
        in: 'header',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      });
    }
    const responses: Record<string, unknown> = {};
    for (const [code, s] of Object.entries(r.responses)) {
      responses[code] = s
        ? { description: 'OK', content: { 'application/json': { schema: schemaOf(s) } } }
        : { description: 'No content' };
    }
    responses['default'] = {
      description: 'Error',
      content: { 'application/json': { schema: errorSchema } },
    };
    (paths[r.path] ??= {})[r.method] = {
      summary: r.summary,
      tags: [r.tag],
      ...(r.auth ? { security: [{ bearer: [] }] } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(r.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: inputSchemaOf(r.body) } },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info,
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    paths,
  };
}
