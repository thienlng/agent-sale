import { allRoutes, apiKeyRoutes } from '@agent-sales/contracts';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { IS_WORKSPACE_SCOPED, REQUIRED_CAPABILITY } from '../src/common/http/auth-context.js';

/**
 * The public API contract (ADR-022 §1): a route a workspace API key may call must be
 * workspace-scoped and guarded by a capability, in its contract and on its controller handler,
 * because the key's rights are exactly `scopes ∩ creator's role`.
 */
let app: NestFastifyApplication;
const handlers = new Map<string, { scoped: boolean; capability: string | undefined }>();

const join = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/');

beforeAll(async () => {
  app = (await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' })).app;
  await app.init();
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!ctrl) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
      const proto = ctrl.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (typeof fn !== 'function' || name === 'constructor') continue;
        const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
        if (path === undefined || method === undefined) continue;
        const key = `${RequestMethod[method].toLowerCase()} ${join(base, path)}`;
        const meta = (k: string) =>
          (Reflect.getMetadata(k, fn) as unknown) ?? (Reflect.getMetadata(k, ctrl) as unknown);
        handlers.set(key, {
          scoped: meta(IS_WORKSPACE_SCOPED) === true,
          capability: meta(REQUIRED_CAPABILITY) as string | undefined,
        });
      }
    }
  }
});
afterAll(async () => {
  await app?.close();
});

const routes = apiKeyRoutes(allRoutes);

describe('public API routes', () => {
  it('exist', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s is workspace-scoped and capability-guarded',
    (key, r) => {
      expect(r.auth && 'workspaceScoped' in r && r.workspaceScoped, `${key} contract`).toBe(true);
      const h = handlers.get(`${r.method} ${r.path.replace(/\{(\w+)\}/g, ':$1')}`);
      expect(h, `${key} handler`).toBeDefined();
      expect(h?.scoped, `${key} @WorkspaceScoped`).toBe(true);
      expect(h?.capability, `${key} @RequireCapability`).toBeTruthy();
    },
  );

  it('settings and developer routes are never callable with an API key', () => {
    const forbidden = /^\/(api-keys|webhook-|members|invitations|admin|auth|billing)/;
    expect(routes.filter((r) => forbidden.test(r.path)).map((r) => r.path)).toEqual([]);
  });
});
