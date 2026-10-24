import {
  AcceptedInvitation,
  type AssignableRole,
  CreatedInvitation,
  InvitationDto,
  InvitationList,
  InvitationPreview,
  MemberDto,
  MemberList,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

export function useMembers() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.members(ws),
    queryFn: async () => (await api('/members', MemberList)).data,
    enabled: Boolean(ws),
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
    remove: useMutation({
      mutationFn: (userId: string) =>
        api(`/members/${userId}/remove`, MemberDto, { method: 'POST' }),
      onSuccess: refresh,
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
