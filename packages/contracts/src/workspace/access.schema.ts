import { z } from 'zod';

// ─── Roles and capabilities (docs/02 SET-01, SET-02; GitHub #38) ──────────────

/**
 * Workspace roles. `owner` is the one member who created the shop; `admin`
 * manages everything except the owner; `sales` and `care` (CSKH) work their
 * own customers; `analyst` reads.
 */
export const WORKSPACE_ROLES = ['owner', 'admin', 'sales', 'care', 'analyst'] as const;
export const WorkspaceRole = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

/** Roles that can be given to someone (there is exactly one owner). */
export const ASSIGNABLE_ROLES = ['admin', 'sales', 'care', 'analyst'] as const;
export const AssignableRole = z.enum(ASSIGNABLE_ROLES);
export type AssignableRole = z.infer<typeof AssignableRole>;

export const CAPABILITIES = [
  /** Invite, change roles, remove members. */
  'members.manage',
  /** Shop settings: CRM sources/statuses/tags, order settings, distribution. */
  'settings.manage',
  /** Bots, FAQ, bot settings. */
  'bots.manage',
  /** Products, stock, warehouses. */
  'catalog.manage',
  'orders.view',
  'orders.manage',
  /** See every customer (without it: only your own and unassigned ones). */
  'contacts.view_all',
  'contacts.view',
  /** Create and edit customers, notes and tags. */
  'contacts.edit',
  /** Change who is Sales / CSKH of a customer. */
  'contacts.assign',
  /** Make a saved view visible to the whole shop. */
  'views.share',
  /** Read the audit trail of workspace and security changes. */
  'audit.view',
  /** Statistics: your own customers' numbers (every customer's with `contacts.view_all`). */
  'analytics.view',
] as const;
export const Capability = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof Capability>;

const ALL: readonly Capability[] = CAPABILITIES;
const WORKER: readonly Capability[] = [
  'orders.view',
  'orders.manage',
  'contacts.view',
  'contacts.edit',
  'analytics.view',
];

/** What each role may do. A role not listed here (legacy data) may do nothing. */
export const ROLE_CAPABILITIES: Record<WorkspaceRole, readonly Capability[]> = {
  owner: ALL,
  admin: ALL,
  sales: WORKER,
  care: WORKER,
  analyst: ['orders.view', 'contacts.view', 'contacts.view_all', 'analytics.view'],
};

export function roleCan(role: string | null | undefined, capability: Capability): boolean {
  const caps = role && role in ROLE_CAPABILITIES ? ROLE_CAPABILITIES[role as WorkspaceRole] : [];
  return caps.includes(capability);
}

// ─── Members (SET-01) ─────────────────────────────────────────────────────────

export const MemberDto = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.enum(['active', 'removed']),
  joinedAt: z.iso.datetime(),
  isYou: z.boolean(),
});
export type MemberDto = z.infer<typeof MemberDto>;
/** Seats of the plan: active members, invitations still waiting, and the limit (`null` = unlimited). */
export const SeatUsage = z.object({
  used: z.number().int(),
  pending: z.number().int(),
  limit: z.number().int().nullable(),
});
export type SeatUsage = z.infer<typeof SeatUsage>;

export const MemberList = z.object({ data: z.array(MemberDto), seats: SeatUsage });
export type MemberList = z.infer<typeof MemberList>;

/** What removing a member does to the customers they own (shown before confirming). */
export const RemovalPreview = z.object({
  sales: z.number().int(),
  care: z.number().int(),
  /** True when they own customers: the removal must say where those go. */
  requiresReassignment: z.boolean(),
});
export type RemovalPreview = z.infer<typeof RemovalPreview>;

/** Where the removed member's customers go: to another member, or to nobody (unassigned). */
export const RemoveMemberRequest = z
  .object({
    reassign: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('unassign') }),
        z.object({ mode: z.literal('transfer'), toUserId: z.uuid() }),
      ])
      .optional(),
  })
  // No body at all means "no hand-over given".
  .default({});
export type RemoveMemberRequest = z.input<typeof RemoveMemberRequest>;

export const ChangeMemberRoleRequest = z.object({ role: AssignableRole });
export type ChangeMemberRoleRequest = z.infer<typeof ChangeMemberRoleRequest>;

// ─── Invitations ──────────────────────────────────────────────────────────────

export const InvitationDto = z.object({
  id: z.uuid(),
  email: z.string(),
  role: AssignableRole,
  invitedByName: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type InvitationDto = z.infer<typeof InvitationDto>;
export const InvitationList = z.object({ data: z.array(InvitationDto) });

export const CreateInvitationRequest = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.trim().toLowerCase()),
  role: AssignableRole,
});
export type CreateInvitationRequest = z.input<typeof CreateInvitationRequest>;

/** The secret is returned once, at creation: share the link with the person invited. */
export const CreatedInvitation = z.object({
  invitation: InvitationDto,
  token: z.string(),
});
export type CreatedInvitation = z.infer<typeof CreatedInvitation>;

/** What the invitee sees before accepting (needs a session, not membership). */
export const InvitationPreview = z.object({
  workspaceName: z.string(),
  role: AssignableRole,
  email: z.string(),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  /** The signed-in user's email matches the invitation. */
  emailMatches: z.boolean(),
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

export const AcceptInvitationRequest = z.object({ token: z.string().min(20).max(200) });
export const AcceptedInvitation = z.object({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  role: AssignableRole,
});
export type AcceptedInvitation = z.infer<typeof AcceptedInvitation>;
