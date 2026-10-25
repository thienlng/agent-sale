import type { MemberDto } from '@agent-sales/contracts';
import { vi } from 'vitest';

// Structural fakes of TeamFacade and IdentityFacade (test helpers may not import other modules).

/** Members the fake team knows; everyone else is not in the workspace. */
export function fakeTeam(members: readonly Pick<MemberDto, 'userId' | 'status'>[] = []) {
  return {
    listMembers: vi.fn(async (): Promise<MemberDto[]> =>
      members.map((m) => ({
        userId: m.userId,
        name: 'Member',
        email: '',
        role: 'sales' as MemberDto['role'],
        status: m.status,
        joinedAt: '2026-01-01T00:00:00.000Z',
        isYou: false,
      })),
    ),
  };
}

/** Display names by user id; unknown users have none. */
export function fakeIdentity(names: Record<string, string> = {}) {
  return {
    displayName: vi.fn(async (id: string) => names[id] ?? null),
    profile: vi.fn(async () => null),
  };
}

/**
 * Fake tag library: chips per conversation and canned filter answers, so the conversation
 * module's use of the crm facade can be checked without the crm module.
 */
export function fakeCrm(
  chips: Record<string, { id: string; name: string; color: string }[]> = {},
  match: { include: string[] | null; exclude: string[] } = { include: null, exclude: [] },
) {
  return {
    conversationTags: vi.fn(
      async (_ws: unknown, ids: readonly string[]) =>
        new Map(ids.flatMap((id) => (chips[id] ? [[id, chips[id]] as const] : []))),
    ),
    conversationIdsByTags: vi.fn(async () => match),
    listConversationTags: vi.fn(async () => []),
    assignConversationTag: vi.fn(async () => ({ created: true, assignment: {} })),
  };
}
