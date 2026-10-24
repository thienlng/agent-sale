import { AuditList, WorkspaceProfileDto } from '@agent-sales/contracts';
import { eq, schema } from '@agent-sales/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, makePng, startHarness } from './support/harness.js';

/** Business profile and private logo on a real Postgres (ADM-02). */
let t: Harness;
beforeAll(async () => {
  t = await startHarness();
});
afterAll(async () => {
  await t?.stop();
});

const profile = async (h: Parameters<Harness['call']>[0]) =>
  WorkspaceProfileDto.parse((await t.call(h, 'GET', '/workspace/profile')).json());

describe('workspace profile', () => {
  it('saves and reloads every field, versions edits and rejects stale ones', async () => {
    const lan = await t.user('lan@profile.vn', 'Chủ shop Lan');
    const first = await profile(lan.h);
    expect(first).toMatchObject({
      name: 'Shop Chủ shop Lan',
      companyName: '',
      hasLogo: false,
      version: 1,
    });

    const saved = await t.call(lan.h, 'PATCH', '/workspace/profile', {
      name: '  Cửa hàng Lan  ',
      companyName: 'Công ty TNHH Lan Fashion',
      businessServices: 'Thời trang nữ, may đo',
      productDescription: 'Áo dài, váy công sở, phụ kiện',
      expectedVersion: 1,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(WorkspaceProfileDto.parse(saved.json())).toMatchObject({
      name: 'Cửa hàng Lan',
      version: 2,
    });
    expect(await profile(lan.h)).toMatchObject({
      name: 'Cửa hàng Lan',
      companyName: 'Công ty TNHH Lan Fashion',
      businessServices: 'Thời trang nữ, may đo',
      productDescription: 'Áo dài, váy công sở, phụ kiện',
      version: 2,
    });
    // The shop name is the same name everywhere.
    expect((await t.call(lan.h, 'GET', '/workspaces/current')).json()).toMatchObject({
      name: 'Cửa hàng Lan',
    });

    // A stale edit conflicts and changes nothing; a no-op keeps the version.
    const stale = await t.call(lan.h, 'PATCH', '/workspace/profile', {
      companyName: 'X',
      expectedVersion: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect((await profile(lan.h)).companyName).toBe('Công ty TNHH Lan Fashion');
    expect(
      WorkspaceProfileDto.parse(
        (
          await t.call(lan.h, 'PATCH', '/workspace/profile', {
            companyName: 'Công ty TNHH Lan Fashion',
            expectedVersion: 2,
          })
        ).json(),
      ).version,
    ).toBe(2);
    // Two editors from the same version: one wins, one conflicts.
    const [x, y] = await Promise.all([
      t.call(lan.h, 'PATCH', '/workspace/profile', { businessServices: 'Một', expectedVersion: 2 }),
      t.call(lan.h, 'PATCH', '/workspace/profile', { businessServices: 'Hai', expectedVersion: 2 }),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);

    // Boundaries.
    expect(
      (await t.call(lan.h, 'PATCH', '/workspace/profile', { name: '   ', expectedVersion: 3 }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await t.call(lan.h, 'PATCH', '/workspace/profile', {
          productDescription: 'x'.repeat(5001),
          expectedVersion: 3,
        })
      ).statusCode,
    ).toBe(400);

    // The audit trail says what changed, with no more than a clipped value.
    const trail = AuditList.parse(
      (await t.call(lan.h, 'GET', '/audit-events?action=workspace.')).json(),
    );
    expect(trail.data[0]).toMatchObject({
      action: 'workspace.profile_updated',
      actorName: 'Chủ shop Lan',
    });
    expect(trail.data.at(-1)?.data).toMatchObject({
      changes: { name: { from: 'Shop Chủ shop Lan', to: 'Cửa hàng Lan' } },
    });
  });

  it('lets any member read the profile, but only settings managers change it', async () => {
    const lan = await t.user('lan2@profile.vn', 'Chủ shop');
    const sale = await t.user('sale2@profile.vn', 'Sales');
    await t.owner.db.insert(schema.members).values({
      id: crypto.randomUUID(),
      workspaceId: lan.ownWorkspace,
      userId: sale.userId,
      role: 'sales',
      status: 'active',
    });
    const asSale = sale.in(lan.ownWorkspace);
    expect((await t.call(asSale, 'GET', '/workspace/profile')).statusCode).toBe(200);
    expect(
      (
        await t.call(asSale, 'PATCH', '/workspace/profile', {
          companyName: 'x',
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await t.raw(asSale, 'PUT', '/workspace/logo', makePng(256), 'image/png')).statusCode,
    ).toBe(403);
    expect((await t.call(asSale, 'DELETE', '/workspace/logo')).statusCode).toBe(403);
    // A stranger sees nothing of this workspace.
    const other = await t.user('other2@profile.vn', 'Người lạ');
    expect((await t.call(other.in(lan.ownWorkspace), 'GET', '/workspace/profile')).statusCode).toBe(
      404,
    );
  });
});

describe('workspace logo', () => {
  it('stores a valid logo privately and serves it with safe headers', async () => {
    const lan = await t.user('lan3@profile.vn', 'Chủ shop');
    expect((await t.call(lan.h, 'GET', '/workspace/logo')).statusCode).toBe(404);

    const png = makePng(720);
    const up = await t.raw(lan.h, 'PUT', '/workspace/logo', png, 'image/png');
    expect(up.statusCode, up.body).toBe(200);
    const after = WorkspaceProfileDto.parse(up.json());
    expect(after).toMatchObject({ hasLogo: true, version: 2 });
    expect(after.logoVersion).toMatch(/^[0-9a-f]{16}$/);

    const got = await t.call(lan.h, 'GET', '/workspace/logo');
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(png)).toBe(true);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(String(got.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(String(got.headers['cache-control'])).toContain('private');
    const etag = String(got.headers['etag']);
    const cached = await t.call({ ...lan.h, 'if-none-match': etag }, 'GET', '/workspace/logo');
    expect(cached.statusCode).toBe(304);

    // The same image again is a no-op (safe to retry).
    const again = WorkspaceProfileDto.parse(
      (await t.raw(lan.h, 'PUT', '/workspace/logo', png, 'image/png')).json(),
    );
    expect(again.version).toBe(2);
    expect(
      (
        await t.owner.db
          .select()
          .from(schema.workspaceAssets)
          .where(eq(schema.workspaceAssets.workspaceId, lan.ownWorkspace))
      ).length,
    ).toBe(1);

    // Another logo replaces it and the old image is gone.
    const next = makePng(512);
    const replaced = WorkspaceProfileDto.parse(
      (await t.raw(lan.h, 'PUT', '/workspace/logo', next, 'image/png')).json(),
    );
    expect(replaced.version).toBe(3);
    expect((await t.call(lan.h, 'GET', '/workspace/logo')).rawPayload.equals(next)).toBe(true);
    expect(
      (
        await t.owner.db
          .select()
          .from(schema.workspaceAssets)
          .where(eq(schema.workspaceAssets.workspaceId, lan.ownWorkspace))
      ).length,
    ).toBe(1);

    // Another workspace has its own (no) logo; ours is not reachable with its headers.
    const other = await t.user('other3@profile.vn', 'Shop khác');
    expect((await t.call(other.h, 'GET', '/workspace/logo')).statusCode).toBe(404);
    expect((await t.call(other.in(lan.ownWorkspace), 'GET', '/workspace/logo')).statusCode).toBe(
      404,
    );

    const trail = AuditList.parse(
      (await t.call(lan.h, 'GET', '/audit-events?action=workspace.logo_changed')).json(),
    );
    expect(trail.data).toHaveLength(2);
    expect(JSON.stringify(trail)).not.toContain(png.toString('base64').slice(0, 40));

    // Removing it.
    expect(
      WorkspaceProfileDto.parse((await t.call(lan.h, 'DELETE', '/workspace/logo')).json()),
    ).toMatchObject({ hasLogo: false });
    expect((await t.call(lan.h, 'GET', '/workspace/logo')).statusCode).toBe(404);
    expect(
      (
        await t.owner.db
          .select()
          .from(schema.workspaceAssets)
          .where(eq(schema.workspaceAssets.workspaceId, lan.ownWorkspace))
      ).length,
    ).toBe(0);
  });

  it('rejects bad uploads with a reason and never loses the current logo', async () => {
    const lan = await t.user('lan4@profile.vn', 'Chủ shop');
    const good = makePng(640);
    await t.raw(lan.h, 'PUT', '/workspace/logo', good, 'image/png');
    const reject = async (body: Buffer, type: string) => {
      const r = await t.raw(lan.h, 'PUT', '/workspace/logo', body, type);
      return {
        status: r.statusCode,
        details: (r.json() as { error?: { details?: Record<string, unknown> } }).error?.details,
      };
    };

    // Not images, whatever the declared type says.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(await reject(svg, 'image/png')).toMatchObject({
      status: 400,
      details: { reason: 'not_an_image' },
    });
    expect(await reject(Buffer.from('<html></html>'), 'image/jpeg')).toMatchObject({
      status: 400,
      details: { reason: 'not_an_image' },
    });
    // Wrong shapes and sizes.
    expect(await reject(makePng(720, 360), 'image/png')).toMatchObject({
      status: 400,
      details: { reason: 'not_square', width: 720, height: 360 },
    });
    expect(await reject(makePng(64), 'image/png')).toMatchObject({
      status: 400,
      details: { reason: 'too_small' },
    });
    expect(await reject(makePng(1040, 1040, true), 'image/png')).toMatchObject({
      status: 400,
      details: { reason: 'too_large' },
    });
    expect(await reject(makePng(640).subarray(0, 100), 'image/png')).toMatchObject({
      status: 400,
      details: { reason: 'corrupt' },
    });
    // A type the server does not read as an image at all.
    expect(
      (await t.raw(lan.h, 'PUT', '/workspace/logo', svg, 'image/svg+xml')).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await t.raw(lan.h, 'PUT', '/workspace/logo', svg, 'text/html')).statusCode,
    ).toBeGreaterThanOrEqual(400);

    // None of it touched the logo that was there.
    const still = await t.call(lan.h, 'GET', '/workspace/logo');
    expect(still.rawPayload.equals(good)).toBe(true);
    expect((await profile(lan.h)).version).toBe(2);
  });
});
