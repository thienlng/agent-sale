import { defineRoutes } from '../common/routes.js';
import {
  AcceptedInvitation,
  AcceptInvitationRequest,
  ChangeMemberRoleRequest,
  CreatedInvitation,
  CreateInvitationRequest,
  InvitationDto,
  InvitationList,
  InvitationPreview,
  MemberDto,
  MemberList,
} from './access.schema.js';

const scoped = { tag: 'workspace', auth: true, workspaceScoped: true } as const;

export const accessRoutes = defineRoutes([
  {
    method: 'get',
    path: '/members',
    summary: 'Members of the workspace',
    ...scoped,
    responses: { 200: MemberList },
  },
  {
    method: 'patch',
    path: '/members/{userId}',
    summary: 'Change a member role',
    ...scoped,
    body: ChangeMemberRoleRequest,
    responses: { 200: MemberDto },
  },
  {
    method: 'post',
    path: '/members/{userId}/remove',
    summary: 'Remove a member (their work stays)',
    ...scoped,
    responses: { 200: MemberDto },
  },
  {
    method: 'get',
    path: '/invitations',
    summary: 'Invitations of the workspace',
    ...scoped,
    responses: { 200: InvitationList },
  },
  {
    method: 'post',
    path: '/invitations',
    summary: 'Invite someone by email (returns the link secret once)',
    ...scoped,
    body: CreateInvitationRequest,
    responses: { 201: CreatedInvitation },
  },
  {
    method: 'post',
    path: '/invitations/{invitationId}/revoke',
    summary: 'Revoke a pending invitation',
    ...scoped,
    responses: { 200: InvitationDto },
  },
  {
    method: 'get',
    path: '/invitation-links/{token}',
    summary: 'Preview an invitation (signed in, not a member yet)',
    tag: 'workspace',
    auth: true,
    responses: { 200: InvitationPreview },
  },
  {
    method: 'post',
    path: '/invitation-links/accept',
    summary: 'Join the workspace of an invitation sent to your email',
    tag: 'workspace',
    auth: true,
    body: AcceptInvitationRequest,
    responses: { 200: AcceptedInvitation },
  },
]);
