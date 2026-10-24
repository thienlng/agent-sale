import { date, integer, jsonb, pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';

import { tenantPolicies, workspaces } from './workspace.js';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

/** Tenant tables of migration 0006 (docs/05 §5). User ids are plain uuids (users is global). */
const option = (name: string) =>
  pgTable(
    name,
    {
      id: uuid('id').primaryKey(),
      workspaceId: workspaceRef(),
      key: text('key'),
      name: text('name').notNull(),
      color: text('color').notNull(),
      position: integer('position').notNull().default(0),
      archivedAt: ts('archived_at'),
      createdAt: ts('created_at').notNull().defaultNow(),
      updatedAt: ts('updated_at').notNull().defaultNow(),
    },
    () => [...tenantPolicies(name)],
  );

export const crmSources = option('crm_sources');
export const crmStatuses = option('crm_statuses');

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    name: text('name'),
    phone: text('phone'),
    phoneNormalized: text('phone_normalized'),
    email: text('email'),
    emailNormalized: text('email_normalized'),
    birthday: date('birthday', { mode: 'string' }),
    gender: text('gender'),
    address: text('address'),
    province: text('province'),
    ward: text('ward'),
    phoneProvidedAt: ts('phone_provided_at'),
    addressProvidedAt: ts('address_provided_at'),
    sourceId: uuid('source_id').references(() => crmSources.id),
    firstSourceId: uuid('first_source_id').references(() => crmSources.id),
    statusId: uuid('status_id').references(() => crmStatuses.id),
    salesUserId: uuid('sales_user_id'),
    careUserId: uuid('care_user_id'),
    adRef: text('ad_ref'),
    profileNote: text('profile_note').notNull().default(''),
    searchText: text('search_text').notNull().default(''),
    clientRequestId: uuid('client_request_id'),
    version: integer('version').notNull().default(1),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    archivedAt: ts('archived_at'),
  },
  () => [...tenantPolicies('contacts')],
);

export const contactNotes = pgTable(
  'contact_notes',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    body: text('body').notNull(),
    authorUserId: uuid('author_user_id'),
    authorName: text('author_name'),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    editedAt: ts('edited_at'),
  },
  () => [...tenantPolicies('contact_notes')],
);

export const contactHistory = pgTable(
  'contact_history',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    type: text('type').notNull(),
    changes: jsonb('changes')
      .notNull()
      .default({})
      .$type<Record<string, { from: unknown; to: unknown }>>(),
    data: jsonb('data').notNull().default({}).$type<Record<string, unknown>>(),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  () => [...tenantPolicies('contact_history')],
);

export const crmTags = pgTable(
  'crm_tags',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    type: text('type').notNull(),
    description: text('description').notNull().default(''),
    fields: jsonb('fields').notNull().default([]).$type<unknown[]>(),
    schemaVersion: integer('schema_version').notNull().default(1),
    isSystem: boolean('is_system').notNull().default(false),
    key: text('key'),
    createdByUserId: uuid('created_by_user_id'),
    createdByName: text('created_by_name'),
    version: integer('version').notNull().default(1),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  () => [...tenantPolicies('crm_tags')],
);

export const crmTagAssignments = pgTable(
  'crm_tag_assignments',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => crmTags.id),
    tagType: text('tag_type').notNull(),
    scope: text('scope').notNull(),
    entityId: uuid('entity_id').notNull(),
    values: jsonb('values').notNull().default({}).$type<Record<string, unknown>>(),
    schemaVersion: integer('schema_version').notNull(),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
    assignedByUserId: uuid('assigned_by_user_id'),
    assignedByName: text('assigned_by_name'),
    removedAt: ts('removed_at'),
    removedByUserId: uuid('removed_by_user_id'),
    removeReason: text('remove_reason'),
    version: integer('version').notNull().default(1),
  },
  () => [...tenantPolicies('crm_tag_assignments')],
);

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    ownerUserId: uuid('owner_user_id').notNull(),
    ownerName: text('owner_name'),
    entity: text('entity').notNull().default('contact'),
    name: text('name').notNull(),
    visibility: text('visibility').notNull(),
    q: text('q').notNull().default(''),
    filter: jsonb('filter').notNull().$type<Record<string, unknown>>(),
    sort: jsonb('sort').notNull().$type<unknown[]>(),
    columns: jsonb('columns').notNull().default([]).$type<string[]>(),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  () => [...tenantPolicies('saved_views')],
);
