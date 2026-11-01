import {
  CreateCrmOptionRequest,
  CreateTagRequest,
  type CrmAssigneeList,
  type CrmOptionDto,
  ReorderCrmOptionsRequest,
  type TagDto,
  UpdateCrmOptionRequest,
  UpdateTagRequest,
} from '@agent-sales/contracts';
import { isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { DEFAULT_SOURCES, DEFAULT_TAGS, defaultStatusesFor } from '../domain/crm-defaults.js';
import {
  DuplicateOptionNameError,
  CrmOptionNotFoundError,
  InvalidContactError,
  StaleVersionError,
  TagFieldChangeError,
  TagNotFoundError,
} from '../domain/crm.errors.js';
import type { TagField } from '../domain/tag-values.js';
import { toOptionDto, toTagDto } from './crm.mappers.js';
import { CRM_STORE, type CrmStore, type CrmTx, type OptionKind } from './ports/crm-store.js';

/**
 * Field schema evolution: fields keep their key and type forever (values on old
 * assignments must stay readable); they can be relabeled, made (not) required,
 * get options, or be archived. Options can be archived, never removed.
 */
function assertFieldEvolution(before: readonly TagField[], after: readonly TagField[]): void {
  for (const old of before) {
    const now = after.find((f) => f.key === old.key);
    if (!now || now.type !== old.type) throw new TagFieldChangeError(old.key);
    for (const o of old.options) {
      if (!now.options.some((x) => x.id === o.id)) throw new TagFieldChangeError(old.key);
    }
  }
}

/** JSON with sorted object keys: stored jsonb reorders keys, so plain JSON.stringify differs. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Customer sources, pipeline statuses, tag definitions and assignees (CRM-03, CRM-04). */
@Injectable()
export class CrmSettingsService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  // ─── sources and statuses ─────────────────────────────────────────────────

  /** Sources are the same everywhere; statuses depend on the business's industry. */
  async #defaults(ws: WorkspaceId, kind: OptionKind) {
    if (kind === 'source') return DEFAULT_SOURCES;
    return defaultStatusesFor((await this.workspaces.getById(ws)).industry);
  }

  async listOptions(ws: WorkspaceId, kind: OptionKind): Promise<CrmOptionDto[]> {
    const defaults = await this.#defaults(ws, kind);
    return this.store.run(ws, async (tx) => {
      await tx.options.ensureDefaults(ws, kind, defaults);
      return (await tx.options.list(kind)).map(toOptionDto);
    });
  }

  async createOption(ws: WorkspaceId, kind: OptionKind, raw: unknown): Promise<CrmOptionDto> {
    const input = CreateCrmOptionRequest.parse(raw);
    const defaults = await this.#defaults(ws, kind);
    return this.store.run(ws, async (tx) => {
      await tx.options.ensureDefaults(ws, kind, defaults);
      const all = await tx.options.list(kind);
      assertUniqueName(kind, all, input.name);
      const last = all.at(-1);
      const option = {
        id: newId(),
        key: null,
        name: input.name,
        color: input.color,
        position: (last?.position ?? -1) + 1,
        archivedAt: null,
      };
      await tx.options.insert(ws, kind, option);
      return toOptionDto(option);
    });
  }

  /** Rename, recolor, archive or restore. Archived options stay on contacts and in history. */
  updateOption(ws: WorkspaceId, kind: OptionKind, id: string, raw: unknown): Promise<CrmOptionDto> {
    const input = UpdateCrmOptionRequest.parse(raw);
    return this.store.run(ws, async (tx) => {
      const option = isUuid(id) ? await tx.options.find(kind, id) : null;
      if (!option) throw new CrmOptionNotFoundError(kind, id);
      const next = {
        ...option,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.archived !== undefined
          ? { archivedAt: input.archived ? (option.archivedAt ?? new Date()) : null }
          : {}),
      };
      // Renaming, or restoring an archived option, must not clash with another active one.
      const clashes = next.name !== option.name || (option.archivedAt && !next.archivedAt);
      if (clashes && !next.archivedAt)
        assertUniqueName(kind, await tx.options.list(kind), next.name, id);
      await tx.options.update(kind, next);
      return toOptionDto(next);
    });
  }

  /** `ids` must list every option of the kind exactly once. */
  reorder(ws: WorkspaceId, kind: OptionKind, raw: unknown): Promise<CrmOptionDto[]> {
    const { ids } = ReorderCrmOptionsRequest.parse(raw);
    return this.store.run(ws, async (tx) => {
      const all = await tx.options.list(kind);
      const same =
        ids.length === all.length &&
        new Set(ids).size === ids.length &&
        all.every((o) => ids.includes(o.id));
      if (!same) throw new InvalidContactError({ ids: 'list every option exactly once' });
      const byId = new Map(all.map((o) => [o.id, o]));
      const out = [];
      for (const [position, id] of ids.entries()) {
        const current = byId.get(id);
        if (!current) continue;
        const o = { ...current, position };
        if (o.position !== current.position) await tx.options.update(kind, o);
        out.push(o);
      }
      return out.map(toOptionDto);
    });
  }

  // ─── tags ─────────────────────────────────────────────────────────────────

  listTags(ws: WorkspaceId): Promise<TagDto[]> {
    return this.store.run(ws, async (tx) => {
      await this.#ensureTags(tx, ws);
      return (await tx.tags.list()).map((t) => toTagDto(t, t.activeCount));
    });
  }

  async createTag(ws: WorkspaceId, raw: unknown, actor: string): Promise<TagDto> {
    const input = CreateTagRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      await this.#ensureTags(tx, ws);
      const now = new Date();
      const tag = {
        id: newId(),
        name: input.name,
        color: input.color,
        type: input.type,
        description: input.description,
        fields: input.type === 'classification' ? [] : input.fields,
        schemaVersion: 1,
        isSystem: false,
        key: null,
        createdByUserId: actor,
        createdByName: actorName,
        version: 1,
        archivedAt: null,
        updatedAt: now,
      };
      await tx.tags.insert(ws, tag);
      return toTagDto(tag, 0);
    });
  }

  /** The type never changes (assignments depend on it); fields evolve additively. */
  updateTag(ws: WorkspaceId, id: string, raw: unknown): Promise<TagDto> {
    const input = UpdateTagRequest.parse(raw);
    return this.store.run(ws, async (tx) => {
      const tag = isUuid(id) ? await tx.tags.find(id, { forUpdate: true }) : null;
      if (!tag) throw new TagNotFoundError(id);
      if (tag.version !== input.expectedVersion) throw new StaleVersionError('tag', tag.version);
      const fieldsChanged =
        input.fields !== undefined && canonical(input.fields) !== canonical(tag.fields);
      if (fieldsChanged && input.fields) assertFieldEvolution(tag.fields, input.fields);
      const next = {
        ...tag,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(fieldsChanged && input.fields && tag.type !== 'classification'
          ? { fields: input.fields, schemaVersion: tag.schemaVersion + 1 }
          : {}),
        ...(input.archived !== undefined
          ? { archivedAt: input.archived ? (tag.archivedAt ?? new Date()) : null }
          : {}),
        version: tag.version + 1,
        updatedAt: new Date(),
      };
      await tx.tags.update(next);
      const count = (await tx.tags.list()).find((t) => t.id === id)?.activeCount ?? 0;
      return toTagDto(next, count);
    });
  }

  // ─── assignees ────────────────────────────────────────────────────────────

  async assignees(ws: WorkspaceId): Promise<CrmAssigneeList['data']> {
    const members = await this.workspaces.listMembers(ws);
    return Promise.all(
      members.map(async (m) => ({
        userId: m.userId,
        name: (await this.identity.displayName(m.userId)) ?? '—',
        role: m.role,
      })),
    );
  }

  #ensureTags(tx: CrmTx, ws: WorkspaceId): Promise<void> {
    return tx.tags.ensureDefaults(ws, DEFAULT_TAGS);
  }
}

/**
 * Active options of one kind have distinct names (trimmed, case-insensitive). Checked here rather
 * than by a unique index: older workspaces may already hold duplicates, which stay valid until an
 * owner renames or archives one (T-089).
 */
function assertUniqueName(
  kind: OptionKind,
  options: ReadonlyArray<{ id: string; name: string; archivedAt: Date | null }>,
  name: string,
  except?: string,
): void {
  const wanted = name.trim().toLocaleLowerCase('vi');
  const clash = options.some(
    (o) => o.id !== except && !o.archivedAt && o.name.trim().toLocaleLowerCase('vi') === wanted,
  );
  if (clash) throw new DuplicateOptionNameError(kind, name);
}
