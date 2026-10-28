/** Settings fixtures (profile, security, audit) with long content for the layout guard. */
const now = '2026-10-24T08:00:00.000Z';
const LONG =
  'Công ty TNHH Thương mại và Dịch vụ Thời trang Nguyễn Thị Thanh Hương Lan Anh Phương Thảo';
const uuid = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f${String(n).padStart(2, '0')}`;

const event = (n: number, action: string, data: Record<string, unknown>) => ({
  id: uuid(n),
  action,
  targetType: action.split('.')[0],
  targetId: uuid(90 + n),
  actorName: `Nguyễn Thị Thanh Hương Lan Anh Phương Thảo Ngọc Bích ${n}`,
  data,
  at: now,
});

export function settingsRoute(path: string): unknown {
  if (path === '/workspace/profile')
    return {
      name: LONG,
      companyName: LONG,
      businessServices: LONG.repeat(3),
      productDescription: LONG.repeat(6),
      icon: 'building',
      hasLogo: false,
      logoVersion: null,
      version: 4,
      updatedAt: now,
    };
  if (path === '/auth/mfa') return { enabled: true, recoveryCodesLeft: 6 };
  if (path === '/audit-events')
    return {
      data: [
        event(1, 'workspace.profile_updated', { name: { from: LONG, to: `${LONG} mới` } }),
        event(2, 'member.role_changed', { role: { from: 'sales', to: 'manager' }, email: LONG }),
        event(3, 'member.removed', { email: `${'x'.repeat(60)}@shop.vn`, customers: 1234 }),
      ],
      next: null,
    };
  return undefined;
}
