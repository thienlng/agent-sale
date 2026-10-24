import {
  AcceptedInvitation,
  type AssignableRole,
  CreatedInvitation,
  InvitationDto,
  InvitationList,
  InvitationPreview,
  MemberDto,
  MemberList,
  RemovalPreview,
  type RemoveMemberRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

/** Members with the seat indicator (`seats`). */
export function useMembers() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.members(ws),
    queryFn: () => api('/members', MemberList),
    enabled: Boolean(ws),
  });
}

/** What removing a member does to the customers they own; fetched when the dialog opens. */
export function useRemovalPreview(userId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.members(ws), 'removal', userId],
    queryFn: () => api(`/members/${userId}/removal-preview`, RemovalPreview),
    enabled: Boolean(ws && userId),
    // Always fresh: customers may have changed hands since the page loaded.
    staleTime: 0,
    gcTime: 0,
  });
}

export function useInvitations(enabled: boolean) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.invitations(ws),
    queryFn: async () => (await api('/invitations', InvitationList)).data,
    enabled: Boolean(ws) && enabled,
  });
}

/** Member and invitation changes; each refreshes members, invitations and assignee pickers. */
export function useTeamMutations() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.members(ws) });
    void qc.invalidateQueries({ queryKey: queryKeys.invitations(ws) });
    void qc.invalidateQueries({ queryKey: queryKeys.crmAssignees(ws) });
  };
  return {
    invite: useMutation({
      mutationFn: (body: { email: string; role: AssignableRole }) =>
        api('/invitations', CreatedInvitation, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (id: string) =>
        api(`/invitations/${id}/revoke`, InvitationDto, { method: 'POST' }),
      onSuccess: refresh,
    }),
    changeRole: useMutation({
      mutationFn: (v: { userId: string; role: AssignableRole }) =>
        api(`/members/${v.userId}`, MemberDto, { method: 'PATCH', body: { role: v.role } }),
      onSuccess: refresh,
    }),
    resend: useMutation({
      mutationFn: (id: string) =>
        api(`/invitations/${id}/resend`, CreatedInvitation, { method: 'POST' }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (v: { userId: string; body: RemoveMemberRequest }) =>
        api(`/members/${v.userId}/remove`, MemberDto, { method: 'POST', body: v.body }),
      onSuccess: () => {
        refresh();
        // Customers changed hands.
        void qc.invalidateQueries({ queryKey: queryKeys.contacts(ws) });
      },
    }),
  };
}

/** Invitation links work before membership: not workspace-scoped. */
export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitation-link', token],
    queryFn: () =>
      api(`/invitation-links/${encodeURIComponent(token)}`, InvitationPreview, {
        workspaceScoped: false,
      }),
    retry: false,
  });
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: (token: string) =>
      api('/invitation-links/accept', AcceptedInvitation, {
        method: 'POST',
        body: { token },
        workspaceScoped: false,
      }),
  });
}

/** The link to share with the invitee (the secret is in the query of /join). */
export function invitationLink(token: string): string {
  return `${window.location.origin}/join?token=${encodeURIComponent(token)}`;
}
