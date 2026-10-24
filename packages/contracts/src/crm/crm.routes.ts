import { defineRoutes, type RouteContract } from '../common/routes.js';
import {
  ContactListResponse,
  ContactQueryRequest,
  CreateSavedViewRequest,
  SavedViewDto,
  SavedViewList,
  UpdateSavedViewRequest,
} from './contact-query.schema.js';
import {
  ContactDto,
  ContactHistoryList,
  ContactHistoryQuery,
  ContactNoteDto,
  ContactNoteList,
  CreateContactNoteRequest,
  CreateContactRequest,
  UpdateContactNoteRequest,
  UpdateContactRequest,
} from './contact.schema.js';
import {
  AssignTagRequest,
  CreateCrmOptionRequest,
  CreateTagRequest,
  CrmAssigneeList,
  CrmOptionDto,
  CrmOptionList,
  RemoveTagAssignmentRequest,
  ReorderCrmOptionsRequest,
  TagAssignmentDto,
  TagAssignmentList,
  TagDto,
  TagList,
  UpdateCrmOptionRequest,
  UpdateTagAssignmentRequest,
  UpdateTagRequest,
} from './crm-settings.schema.js';

const route = <T extends Omit<RouteContract, 'auth' | 'workspaceScoped' | 'tag'>>(r: T) =>
  ({
    ...r,
    tag: 'crm',
    auth: true,
    workspaceScoped: true,
  }) as const;

/** Option routes for one kind (sources or statuses). */
const options = (kind: 'sources' | 'statuses', label: string) =>
  [
    route({
      method: 'get',
      path: `/crm/${kind}`,
      summary: `${label} (archived included)`,
      responses: { 200: CrmOptionList },
    }),
    route({
      method: 'post',
      path: `/crm/${kind}`,
      summary: `Add a ${label.toLowerCase().replace(/s$/, '')}`,
      body: CreateCrmOptionRequest,
      responses: { 201: CrmOptionDto },
    }),
    route({
      method: 'patch',
      path: `/crm/${kind}/{optionId}`,
      summary: `Rename, recolor or archive`,
      body: UpdateCrmOptionRequest,
      responses: { 200: CrmOptionDto },
    }),
    route({
      method: 'put',
      path: `/crm/${kind}/order`,
      summary: `Reorder ${label.toLowerCase()}`,
      body: ReorderCrmOptionsRequest,
      responses: { 200: CrmOptionList },
    }),
  ] as const;

export const crmRoutes = defineRoutes([
  route({
    method: 'post',
    path: '/contacts',
    summary: 'Create a customer',
    body: CreateContactRequest,
    responses: { 201: ContactDto },
  }),
  route({
    method: 'post',
    path: '/contacts/query',
    summary: 'Search and filter customers (typed filter)',
    body: ContactQueryRequest,
    responses: { 200: ContactListResponse },
  }),
  route({
    method: 'get',
    path: '/contacts/{contactId}',
    summary: 'One customer',
    responses: { 200: ContactDto },
  }),
  route({
    method: 'patch',
    path: '/contacts/{contactId}',
    summary: 'Edit a customer (version-checked)',
    body: UpdateContactRequest,
    responses: { 200: ContactDto },
  }),
  route({
    method: 'get',
    path: '/contacts/{contactId}/notes',
    summary: 'Notes, newest first',
    responses: { 200: ContactNoteList },
  }),
  route({
    method: 'post',
    path: '/contacts/{contactId}/notes',
    summary: 'Add a note (never messages the customer)',
    body: CreateContactNoteRequest,
    responses: { 201: ContactNoteDto },
  }),
  route({
    method: 'patch',
    path: '/contacts/{contactId}/notes/{noteId}',
    summary: 'Edit a note (version-checked)',
    body: UpdateContactNoteRequest,
    responses: { 200: ContactNoteDto },
  }),
  route({
    method: 'get',
    path: '/contacts/{contactId}/history',
    summary: 'Audit timeline',
    query: ContactHistoryQuery,
    responses: { 200: ContactHistoryList },
  }),
  route({
    method: 'get',
    path: '/contacts/{contactId}/tags',
    summary: 'Tag assignments (active and removed)',
    responses: { 200: TagAssignmentList },
  }),
  route({
    method: 'post',
    path: '/contacts/{contactId}/tags',
    summary: 'Tag a customer (idempotent per tag)',
    body: AssignTagRequest,
    responses: { 200: TagAssignmentDto, 201: TagAssignmentDto },
  }),
  route({
    method: 'patch',
    path: '/tag-assignments/{assignmentId}',
    summary: 'Change the values of a tag on a customer',
    body: UpdateTagAssignmentRequest,
    responses: { 200: TagAssignmentDto },
  }),
  route({
    method: 'post',
    path: '/tag-assignments/{assignmentId}/remove',
    summary: 'Remove a tag (idempotent)',
    body: RemoveTagAssignmentRequest,
    responses: { 200: TagAssignmentDto },
  }),

  ...options('sources', 'Customer sources'),
  ...options('statuses', 'Pipeline statuses'),
  route({
    method: 'get',
    path: '/crm/tags',
    summary: 'Tag definitions',
    responses: { 200: TagList },
  }),
  route({
    method: 'post',
    path: '/crm/tags',
    summary: 'Create a tag',
    body: CreateTagRequest,
    responses: { 201: TagDto },
  }),
  route({
    method: 'patch',
    path: '/crm/tags/{tagId}',
    summary: 'Edit or archive a tag (version-checked)',
    body: UpdateTagRequest,
    responses: { 200: TagDto },
  }),
  route({
    method: 'get',
    path: '/crm/assignees',
    summary: 'Members who can be Sales or CSKH',
    responses: { 200: CrmAssigneeList },
  }),

  route({
    method: 'get',
    path: '/saved-views',
    summary: 'Your views and shared views',
    responses: { 200: SavedViewList },
  }),
  route({
    method: 'post',
    path: '/saved-views',
    summary: 'Save a view',
    body: CreateSavedViewRequest,
    responses: { 201: SavedViewDto },
  }),
  route({
    method: 'patch',
    path: '/saved-views/{viewId}',
    summary: 'Edit your view (version-checked)',
    body: UpdateSavedViewRequest,
    responses: { 200: SavedViewDto },
  }),
  route({
    method: 'delete',
    path: '/saved-views/{viewId}',
    summary: 'Delete your view',
    responses: { 204: null },
  }),
]);
