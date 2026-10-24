import {
  CONTACT_FILTER_FIELDS,
  type ContactFilter,
  type ContactFilterRule,
  type ContactSort,
} from '@agent-sales/contracts';
import { schema, type SQL, sql } from '@agent-sales/db';
import { isUuid, normalizeAnyPhone, normalizeEmail } from '@agent-sales/shared';

import { InvalidContactError } from '../../domain/crm.errors.js';

const c = schema.contacts;

/** The user's text taken literally inside LIKE (\\, % and _ escaped). */
const likeAny = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** Text columns; empty string and NULL both count as "no value". */
const TEXT: Record<string, SQL> = {
  name: sql`${c.name}`,
  email: sql`${c.email}`,
  address: sql`concat_ws(', ', ${c.address}, ${c.ward}, ${c.province})`,
  profileNote: sql`${c.profileNote}`,
  adRef: sql`${c.adRef}`,
};
const REF: Record<string, SQL> = {
  sourceId: sql`${c.sourceId}`,
  statusId: sql`${c.statusId}`,
  salesUserId: sql`${c.salesUserId}`,
  careUserId: sql`${c.careUserId}`,
  gender: sql`${c.gender}`,
};
const GENDERS = new Set(['male', 'female', 'other']);

function list(rule: ContactFilterRule): string[] {
  const v = Array.isArray(rule.value) ? rule.value : [];
  const bad = v.filter((x) => (rule.field === 'gender' ? !GENDERS.has(x) : !isUuid(x)));
  if (bad.length) throw new InvalidContactError({ [rule.field]: 'unknown value in filter' });
  return v;
}

const inList = (col: SQL, values: string[]) =>
  sql`${col} in (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

function textRule(col: SQL, op: string, raw: string): SQL {
  const v = raw.trim();
  const value = sql`coalesce(${col}, '')`;
  switch (op) {
    case 'contains':
      return sql`${value} ilike ${likeAny(v)} escape '\\'`;
    case 'not_contains':
      return sql`${value} not ilike ${likeAny(v)} escape '\\'`;
    case 'eq':
      return sql`lower(${value}) = lower(${v})`;
    case 'neq':
      return sql`lower(${value}) <> lower(${v})`;
    case 'is_set':
      return sql`${value} <> ''`;
    default:
      return sql`${value} = ''`;
  }
}

/** Phone: equality on the normalized number; "contains" on the digits as typed or normalized. */
function phoneRule(op: string, raw: string): SQL {
  if (op === 'is_set') return sql`${c.phone} is not null`;
  if (op === 'is_empty') return sql`${c.phone} is null`;
  const digits = raw.replace(/\D/g, '');
  const normalized = normalizeAnyPhone(raw) ?? (digits ? `+${digits}` : raw.trim());
  if (op === 'eq') return sql`${c.phoneNormalized} = ${normalized}`;
  if (op === 'neq') return sql`coalesce(${c.phoneNormalized}, '') <> ${normalized}`;
  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  const hit = sql`(coalesce(${c.phone}, '') ilike ${likeAny(raw.trim())} escape '\\'
    or (${local !== ''} and coalesce(${c.phoneNormalized}, '') like ${likeAny(local)} escape '\\'))`;
  return op === 'contains' ? hit : sql`not ${hit}`;
}

function dateRule(rule: ContactFilterRule, timezone: string): SQL {
  const col =
    rule.field === 'birthday'
      ? sql`${c.birthday}`
      : rule.field === 'createdAt'
        ? sql`(${c.createdAt} at time zone ${timezone})::date`
        : sql`(${c.updatedAt} at time zone ${timezone})::date`;
  const raw = rule.field === 'birthday' ? sql`${c.birthday}` : col;
  switch (rule.op) {
    case 'is_set':
      return sql`${raw} is not null`;
    case 'is_empty':
      return sql`${raw} is null`;
    case 'before':
      return sql`${col} < ${rule.value as string}::date`;
    case 'after':
      return sql`${col} > ${rule.value as string}::date`;
    default: {
      const { from, to } = rule.value as { from: string; to: string };
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      return sql`${col} between ${lo}::date and ${hi}::date`;
    }
  }
}

function tagRule(rule: ContactFilterRule): SQL {
  const ids = list(rule);
  // Aliased and qualified: the correlation must point at the outer contacts row.
  const has = sql`exists (select 1 from crm_tag_assignments ta where ta.scope = 'contact'
    and ta.entity_id = contacts.id and ta.removed_at is null and ${inList(sql`ta.tag_id`, ids)})`;
  return rule.op === 'has_any' ? has : sql`not ${has}`;
}

function compileRule(rule: ContactFilterRule, timezone: string): SQL {
  const kind = CONTACT_FILTER_FIELDS[rule.field];
  if (rule.field === 'phone') return phoneRule(rule.op, String(rule.value ?? ''));
  if (rule.field === 'email' && (rule.op === 'eq' || rule.op === 'neq')) {
    const v = normalizeEmail(String(rule.value ?? ''));
    return rule.op === 'eq'
      ? sql`${c.emailNormalized} = ${v}`
      : sql`coalesce(${c.emailNormalized}, '') <> ${v}`;
  }
  switch (kind) {
    case 'text': {
      const col = TEXT[rule.field];
      if (!col) throw new InvalidContactError({ [rule.field]: 'not filterable' });
      return textRule(col, rule.op, String(rule.value ?? ''));
    }
    case 'enum':
    case 'ref': {
      const col = REF[rule.field];
      if (!col) throw new InvalidContactError({ [rule.field]: 'not filterable' });
      if (rule.op === 'is_set') return sql`${col} is not null`;
      if (rule.op === 'is_empty') return sql`${col} is null`;
      const values = list(rule);
      return rule.op === 'in'
        ? inList(col, values)
        : sql`(${col} is null or not ${inList(col, values)})`;
    }
    case 'tag':
      return tagRule(rule);
    default:
      return dateRule(rule, timezone);
  }
}

/**
 * The WHERE clause of a contact query: free text AND (rules joined by AND for
 * `all`, OR for `any`) AND the duplicate switch. List rows and the total count
 * use this one compiler, so they always agree (exports will too).
 */
export function compileContactWhere(input: {
  q?: string | undefined;
  filter: ContactFilter;
  timezone: string;
  ownerScope?: string | null | undefined;
}): SQL {
  const parts: SQL[] = [sql`${c.archivedAt} is null`];
  if (input.ownerScope) {
    const me = input.ownerScope;
    parts.push(sql`(${c.salesUserId} = ${me} or ${c.careUserId} = ${me}
      or (${c.salesUserId} is null and ${c.careUserId} is null))`);
  }
  if (input.q) parts.push(sql`${c.searchText} like ${likeAny(input.q)} escape '\\'`);
  const rules = input.filter.rules.map((r) => compileRule(r, input.timezone));
  if (rules.length) {
    parts.push(sql`(${sql.join(rules, input.filter.match === 'any' ? sql` or ` : sql` and `)})`);
  }
  if (input.filter.duplicatesOnly) {
    // Empty phones never form a group.
    parts.push(sql`${c.phoneNormalized} in (select d.phone_normalized from contacts d
      where d.archived_at is null and d.phone_normalized is not null
      group by d.phone_normalized having count(*) > 1)`);
  }
  return sql.join(parts, sql` and `);
}

const SORT_COLUMNS = {
  name: sql`${c.name}`,
  createdAt: sql`${c.createdAt}`,
  updatedAt: sql`${c.updatedAt}`,
  birthday: sql`${c.birthday}`,
} as const;

/** ORDER BY with empty values last and the id as a stable tie-break. */
export function compileContactOrder(sort: ContactSort): SQL {
  const keys = sort.map((s) =>
    s.dir === 'asc'
      ? sql`${SORT_COLUMNS[s.field]} asc nulls last`
      : sql`${SORT_COLUMNS[s.field]} desc nulls last`,
  );
  return sql.join([...keys, sql`${c.id} asc`], sql`, `);
}
