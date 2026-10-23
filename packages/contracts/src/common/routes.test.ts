import { describe, expect, it } from 'vitest';

import { allRoutes, buildOpenApiDocument } from '../index.js';

describe('buildOpenApiDocument', () => {
  const doc = buildOpenApiDocument(allRoutes, { title: 'Razpi API', version: 'test' }) as {
    openapi: string;
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };

  it('produces an OpenAPI 3.1 document with every declared route', () => {
    expect(doc.openapi).toBe('3.1.0');
    for (const r of allRoutes)
      expect(doc.paths[r.path]?.[r.method], `${r.method} ${r.path}`).toBeDefined();
  });

  it('marks authenticated routes with bearer security and workspace header', () => {
    const op = doc.paths['/workspaces/current']?.['get'] as {
      security?: unknown;
      parameters?: Array<{ name: string }>;
    };
    expect(op.security).toEqual([{ bearer: [] }]);
    expect(op.parameters?.map((p) => p.name)).toContain('X-Workspace-Id');
  });

  it('documents the request body from the input schema', () => {
    const op = doc.paths['/workspaces']?.['post'] as {
      requestBody?: { content: Record<string, { schema: { required?: string[] } }> };
    };
    expect(op.requestBody?.content['application/json']?.schema.required).toEqual([
      'name',
      'industry',
    ]);
  });
});
