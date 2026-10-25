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
