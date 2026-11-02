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

export interface LoginCredentials {
  user: string;
  password: string;
}

/**
 * Creates or repairs the app logins: the tenant and system logins, and the optional owner
 * assistant SQL login (T-171). Used by `migrate --dev-roles` / `--login-roles` and by the
 * integration tests. On an existing login it resets the password and the connection limit and
 * re-grants the group, so a reused login name is repaired.
 *
 * The assistant login must differ from the tenant and system logins. It is a member of
 * `app_assistant_sql` only: any other membership is revoked, and the call throws if one remains.
 * It has at most 10 connections and these role defaults:
 * - read-only transactions, a 3 s statement timeout and `search_path = assistant_sql`;
 * - `temp_file_limit = 256MB` and `work_mem = 16MB`: Postgres has no per-backend memory cap, so
 *   memory is bounded by these, the guard (no string-building function, short literals) and the
 *   timeout;
 * - `track_activities = off`: no assistant session publishes its query text in
 *   `pg_stat_activity`, so another session on the same login has nothing to read.
 * `temp_file_limit` and `track_activities` are superuser-only settings, so the login cannot
 * change them back. Setting them needs a superuser (the migrator is one).
 */
export async function ensureLoginRoles(
  ownerUrl: string,
  logins: {
    tenant: LoginCredentials;
    system: LoginCredentials;
    assistantSql?: LoginCredentials;
  },
): Promise<void> {
  const assistantSql = logins.assistantSql;
  if (
    assistantSql &&
    (assistantSql.user === logins.tenant.user || assistantSql.user === logins.system.user)
  ) {
    throw new Error('the assistant SQL login must differ from the tenant and system logins');
  }
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  const quote = (name: string) => sql.unsafe(`"${name.replace(/"/g, '')}"`);
  try {
    const all: (readonly [LoginCredentials, string, string])[] = [
      [logins.tenant, 'app_tenant', ''],
      [logins.system, 'app_system', ''],
    ];
    if (assistantSql) all.push([assistantSql, 'app_assistant_sql', ' connection limit 10']);
    for (const [login, role, extra] of all) {
      const exists = await sql`select 1 from pg_roles where rolname = ${login.user}`;
      const ident = quote(login.user);
      const pwd = login.password.replace(/'/g, "''");
      if (exists.length === 0) {
        await sql`create role ${ident} login password ${sql.unsafe(`'${pwd}'`)}${sql.unsafe(extra)} in role ${sql.unsafe(role)}`;
      } else {
        await sql`alter role ${ident} login password ${sql.unsafe(`'${pwd}'`)}${sql.unsafe(extra)}`;
        // A login that already existed may have lost its group (a reused name): grant it again.
        const [member] = await sql`
          select 1 as m from pg_auth_members
          where roleid = ${role}::regrole and member = ${login.user}::regrole`;
        if (!member) await sql`grant ${sql.unsafe(role)} to ${ident}`;
      }
    }
    if (assistantSql) {
      const ident = quote(assistantSql.user);
      // Member of app_assistant_sql only: revoke anything else, whoever granted it.
      const strays = await sql<{ role: string; grantor: string }[]>`
        select r.rolname as role, g.rolname as grantor
        from pg_auth_members m
        join pg_roles r on r.oid = m.roleid
        join pg_roles g on g.oid = m.grantor
        where m.member = ${assistantSql.user}::regrole and r.rolname <> 'app_assistant_sql'`;
      for (const s of strays) {
        await sql`revoke ${quote(s.role)} from ${ident} granted by ${quote(s.grantor)}`;
      }
      const left = await sql`
        select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid
        where m.member = ${assistantSql.user}::regrole and r.rolname <> 'app_assistant_sql'`;
      if (left.length > 0) {
        throw new Error(
          `the assistant SQL login is still a member of: ${left.map((r) => String(r['rolname'])).join(', ')}`,
        );
      }
      await sql`alter role ${ident} set default_transaction_read_only = on`;
      await sql`alter role ${ident} set statement_timeout = '3s'`;
      await sql`alter role ${ident} set search_path = assistant_sql`;
      await sql`alter role ${ident} set idle_in_transaction_session_timeout = '5s'`;
      await sql`alter role ${ident} set temp_file_limit = '256MB'`;
      await sql`alter role ${ident} set work_mem = '16MB'`;
      await sql`alter role ${ident} set track_activities = off`;
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
