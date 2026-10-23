import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/** Folder with the ordered, hand-written SQL migrations shipped in this package. */
export const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies `NNNN_name.sql` files in order, one transaction per file, recording
 * name + sha256 in `schema_migrations`. A file whose checksum changed after it
 * was applied is an error: write a new migration instead (Rule 05).
 * Must run as the database owner (not as app_tenant/app_system).
 */
export async function migrate(
  ownerUrl: string,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;
    const done = new Map(
      (
        await sql<
          { name: string; checksum: string }[]
        >`select name, checksum from schema_migrations`
      ).map((r) => [r.name, r.checksum]),
    );
    const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const result: MigrationResult = { applied: [], skipped: [] };
    for (const file of files) {
      const body = await readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex');
      const previous = done.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `migration ${file} was modified after being applied; add a new migration instead`,
          );
        }
        result.skipped.push(file);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name, checksum) values (${file}, ${checksum})`;
      });
      result.applied.push(file);
    }
    return result;
  } finally {
    await sql.end();
  }
}

/**
 * Dev/test only: creates login users for the two application roles.
 * Production users and passwords are provisioned by deploy tooling (T-008).
 */
export async function ensureLoginRoles(
  ownerUrl: string,
  logins: {
    tenant: { user: string; password: string };
    system: { user: string; password: string };
  },
): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    for (const [login, role] of [
      [logins.tenant, 'app_tenant'],
      [logins.system, 'app_system'],
    ] as const) {
      const exists = await sql`select 1 from pg_roles where rolname = ${login.user}`;
      const ident = sql.unsafe(`"${login.user.replace(/"/g, '')}"`);
      const pwd = login.password.replace(/'/g, "''");
      if (exists.length === 0) {
        await sql`create role ${ident} login password ${sql.unsafe(`'${pwd}'`)} in role ${sql.unsafe(role)}`;
      } else {
        await sql`alter role ${ident} login password ${sql.unsafe(`'${pwd}'`)}`;
      }
    }
  } finally {
    await sql.end();
  }
}

/** Replaces the credentials in a postgres:// URL (used to derive app logins from the owner URL in dev/test). */
export function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return u.toString();
}
