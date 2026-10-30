import {
  BotDto,
  AssignmentPolicyDto,
  AssignmentPolicyList,
  type AssignTagRequest,
  type PutAssignmentPolicyRequest,
  ContactDto,
  type ContactHistoryType,
  ContactHistoryList,
  ContactListResponse,
  ContactNoteDto,
  ContactNoteList,
  type ContactQueryRequest,
  type CreateContactRequest,
  type CreateCrmOptionRequest,
  type CreateSavedViewRequest,
  type CreateTagRequest,
  CrmAssigneeList,
  CrmOptionDto,
  CrmOptionList,
  SavedViewDto,
  SavedViewList,
  TagAssignmentDto,
  TagAssignmentList,
  TagDto,
  TagList,
  type UpdateContactRequest,
  type UpdateCrmOptionRequest,
  type UpdateSavedViewRequest,
  type UpdateTagRequest,
} from '@agent-sales/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { withQuery } from '@/lib/url';
import { useWorkspaceId } from '@/lib/use-workspace';

type Kind = 'sources' | 'statuses';

// ─── Contacts ─────────────────────────────────────────────────────────────────

export function useContacts(query: ContactQueryRequest) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.contacts(ws), 'list', query],
    queryFn: () => api('/contacts/query', ContactListResponse, { method: 'POST', body: query }),
    placeholderData: keepPreviousData,
    enabled: Boolean(ws),
  });
}

export function useContact(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.contact(ws, id ?? ''),
    queryFn: () => api(`/contacts/${id}`, ContactDto),
    enabled: Boolean(ws && id),
  });
}

/** A contact changed: refresh lists, its detail, history and tag counts. */
function useContactChanged() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return (contactId: string, dto?: ContactDto) => {
    if (dto) qc.setQueryData(queryKeys.contact(ws, contactId), dto);
    void qc.invalidateQueries({ queryKey: queryKeys.contacts(ws) });
    void qc.invalidateQueries({ queryKey: queryKeys.crmTags(ws) });
  };
}

export function useCreateContact() {
  const changed = useContactChanged();
  return useMutation({
    mutationFn: (body: CreateContactRequest) =>
      api('/contacts', ContactDto, { method: 'POST', body }),
    onSuccess: (c) => changed(c.id, c),
  });
}

export function useUpdateContact(id: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const changed = useContactChanged();
  return useMutation({
    mutationFn: (body: UpdateContactRequest) =>
      api(`/contacts/${id}`, ContactDto, { method: 'PATCH', body }),
    onSuccess: (c) => changed(c.id, c),
    // A stale edit: load the latest version so the user can redo it on top.
    onError: () => void qc.invalidateQueries({ queryKey: queryKeys.contact(ws, id) }),
  });
}

export function useNotes(contactId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.contact(ws, contactId), 'notes'],
    queryFn: async () => (await api(`/contacts/${contactId}/notes`, ContactNoteList)).data,
    enabled: Boolean(ws),
  });
}

export function useAddNote(contactId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api(`/contacts/${contactId}/notes`, ContactNoteDto, { method: 'POST', body: { body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.contact(ws, contactId) }),
  });
}

export function useEditNote(contactId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; body: string; expectedVersion: number }) =>
      api(`/contacts/${contactId}/notes/${v.noteId}`, ContactNoteDto, {
        method: 'PATCH',
        body: { body: v.body, expectedVersion: v.expectedVersion },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.contact(ws, contactId) }),
  });
}

export function useHistory(
  contactId: string,
  q: { type?: ContactHistoryType | undefined; order: 'asc' | 'desc' },
) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.contact(ws, contactId), 'history', q],
    queryFn: async () =>
      (await api(withQuery(`/contacts/${contactId}/history`, q), ContactHistoryList)).data,
    enabled: Boolean(ws),
  });
}

export function useContactTags(contactId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.contact(ws, contactId), 'tags'],
    queryFn: async () => (await api(`/contacts/${contactId}/tags`, TagAssignmentList)).data,
    enabled: Boolean(ws),
  });
}

/** Tag add / value edit / remove; all refresh the contact, the list and tag counts. */
export function useTagMutations(contactId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.contact(ws, contactId) });
    void qc.invalidateQueries({ queryKey: queryKeys.contacts(ws) });
    void qc.invalidateQueries({ queryKey: queryKeys.crmTags(ws) });
  };
  return {
    assign: useMutation({
      mutationFn: (body: AssignTagRequest) =>
        api(`/contacts/${contactId}/tags`, TagAssignmentDto, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: {
        id: string;
        values: AssignTagRequest['values'];
        expectedVersion: number;
      }) =>
        api(`/tag-assignments/${v.id}`, TagAssignmentDto, {
          method: 'PATCH',
          body: { values: v.values, expectedVersion: v.expectedVersion },
        }),
      // Also after a 409: the next try must use the latest version.
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        api(`/tag-assignments/${id}/remove`, TagAssignmentDto, { method: 'POST', body: {} }),
      onSuccess: refresh,
    }),
  };
}

// ─── Sources, statuses, tags, assignees ───────────────────────────────────────

export function useCrmOptions(kind: Kind) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.crmOptions(ws, kind),
    queryFn: async () => (await api(`/crm/${kind}`, CrmOptionList)).data,
    enabled: Boolean(ws),
    staleTime: 60_000,
  });
}

export function useOptionMutations(kind: Kind) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.crmOptions(ws, kind) });
  return {
    create: useMutation({
      mutationFn: (body: CreateCrmOptionRequest) =>
        api(`/crm/${kind}`, CrmOptionDto, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: UpdateCrmOptionRequest }) =>
        api(`/crm/${kind}/${v.id}`, CrmOptionDto, { method: 'PATCH', body: v.body }),
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: (ids: string[]) =>
        api(`/crm/${kind}/order`, CrmOptionList, { method: 'PUT', body: { ids } }),
      onSuccess: (r) => qc.setQueryData(queryKeys.crmOptions(ws, kind), r.data),
    }),
  };
}

/** The business's bots, for the "Bot" customer filter (same cache as the other bot lists). */
export function useCrmBots() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.bots(ws),
    queryFn: async () => (await api('/bots', z.object({ data: z.array(BotDto) }))).data,
    enabled: Boolean(ws),
    staleTime: 30_000,
  });
}

export function useCrmTags() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.crmTags(ws),
    queryFn: async () => (await api('/crm/tags', TagList)).data,
    enabled: Boolean(ws),
    staleTime: 30_000,
  });
}

export function useTagDefinitionMutations() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.crmTags(ws) });
  return {
    create: useMutation({
      mutationFn: (body: CreateTagRequest) => api('/crm/tags', TagDto, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: UpdateTagRequest }) =>
        api(`/crm/tags/${v.id}`, TagDto, { method: 'PATCH', body: v.body }),
      onSettled: refresh,
    }),
  };
}

export function useAssignees() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.crmAssignees(ws),
    queryFn: async () => (await api('/crm/assignees', CrmAssigneeList)).data,
    enabled: Boolean(ws),
    staleTime: 60_000,
  });
}

// ─── Saved views ──────────────────────────────────────────────────────────────

export function useSavedViews() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.savedViews(ws),
    queryFn: async () => (await api('/saved-views', SavedViewList)).data,
    enabled: Boolean(ws),
  });
}

export function useViewMutations() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.savedViews(ws) });
  return {
    create: useMutation({
      mutationFn: (body: CreateSavedViewRequest) =>
        api('/saved-views', SavedViewDto, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: UpdateSavedViewRequest }) =>
        api(`/saved-views/${v.id}`, SavedViewDto, { method: 'PATCH', body: v.body }),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/saved-views/${id}`, z.null(), { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

// ─── Auto-assignment by source (T-033) ────────────────────────────────────────

export function useAssignmentPolicies() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.assignmentPolicies(ws),
    queryFn: async () => (await api('/crm/assignment-policies', AssignmentPolicyList)).data,
    enabled: Boolean(ws),
  });
}

export function usePutAssignmentPolicy() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { sourceId: string; body: PutAssignmentPolicyRequest }) =>
      api(`/crm/assignment-policies/${v.sourceId}`, AssignmentPolicyDto, {
        method: 'PUT',
        body: v.body,
      }),
    // Also after a 409, so the next save starts from the latest version.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.assignmentPolicies(ws) }),
  });
}
