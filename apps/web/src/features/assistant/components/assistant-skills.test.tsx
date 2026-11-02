import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import {
  ASSISTANT_IDS,
  platformSkillFixture,
  skillEventFixture,
  skillFixture,
} from '@/testing/assistant-factories';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { AssistantSkills } from './assistant-skills';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({
  useWorkspaceId: () => '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
}));

beforeAll(() => loadNamespace('assistant'));
afterEach(() => {
  vi.unstubAllGlobals();
  toast.success.mockClear();
  toast.error.mockClear();
});

type Routes = Parameters<typeof stubFetch>[0];
const list = (...items: unknown[]) => ({ status: 200, body: { items } });

describe('AssistantSkills', () => {
  it('approves a pending learned skill in one tap, its body shown on demand', async () => {
    const pending = skillFixture();
    const routes: Routes = {
      'GET /assistant/skills': list(platformSkillFixture(), pending),
      [`GET /assistant/skills/${ASSISTANT_IDS.skill}`]: { status: 200, body: pending },
      [`POST /assistant/skills/${ASSISTANT_IDS.skill}/approve`]: {
        status: 200,
        body: skillFixture({ state: 'active' }),
      },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantSkills />);
    const user = userEvent.setup();

    const waiting = await screen.findByRole('region', { name: 'Đang chờ duyệt' });
    expect(within(waiting).getByText('bao-gia-si')).toBeInTheDocument();
    await user.click(within(waiting).getByRole('button', { name: 'Xem nội dung' }));
    expect(
      await within(waiting).findByText('Giảm 10% khi mua từ 10 sản phẩm.'),
    ).toBeInTheDocument();

    routes['GET /assistant/skills'] = list(
      platformSkillFixture(),
      skillFixture({ state: 'active' }),
    );
    await user.click(within(waiting).getByRole('button', { name: 'Duyệt' }));

    const learned = await screen.findByRole('region', { name: 'Đã học' });
    expect(within(learned).getByText('bao-gia-si')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Đang chờ duyệt' })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.key.endsWith('/approve'))).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith('Đã duyệt kỹ năng.');
  });

  it('undoes a change from the skill ledger', async () => {
    const skill = skillFixture({ state: 'active', provenance: 'owner', patchCount: 1 });
    const events = `GET /assistant/skills/${ASSISTANT_IDS.skill}/events`;
    const undo = `POST /assistant/skill-events/${ASSISTANT_IDS.skillEvent}/undo`;
    const routes: Routes = {
      'GET /assistant/skills': list(skill),
      [`GET /assistant/skills/${ASSISTANT_IDS.skill}`]: { status: 200, body: skill },
      [events]: list(skillEventFixture()),
      [undo]: { status: 200, body: { ...skill, body: 'Giảm 5%.' } },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantSkills />);
    const user = userEvent.setup();

    const mine = await screen.findByRole('region', { name: 'Của anh/chị' });
    await user.click(within(mine).getByRole('button', { name: /bao-gia-si/ }));
    const ledger = await screen.findByRole('region', { name: 'Lịch sử thay đổi' });
    expect(await within(ledger).findByText('Trợ lý (tự học)')).toBeInTheDocument();

    routes[`GET /assistant/skills/${ASSISTANT_IDS.skill}`] = {
      status: 200,
      body: { ...skill, body: 'Giảm 5%.', updatedAt: '2026-11-02T09:00:00.000Z' },
    };
    routes[events] = list(
      skillEventFixture({
        id: '0193b000-0000-7000-8000-000000000502',
        actor: 'owner',
        action: 'undo',
        createdAt: '2026-11-02T09:00:00.000Z',
      }),
      skillEventFixture({ undoneAt: '2026-11-02T09:00:00.000Z' }),
    );
    await user.click(within(ledger).getByRole('button', { name: 'Hoàn tác' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã hoàn tác thay đổi.'));
    expect(calls.filter((c) => c.key === undo)).toHaveLength(1);
    // The editor shows the restored text, and nothing is left to undo.
    expect(await screen.findByDisplayValue('Giảm 5%.')).toBeInTheDocument();
    expect(within(ledger).getByText('Đã hoàn tác')).toBeInTheDocument();
    expect(within(ledger).queryByRole('button', { name: 'Hoàn tác' })).not.toBeInTheDocument();
  });

  it('says why an undo is refused when the skill changed since', async () => {
    const skill = skillFixture({ state: 'active', provenance: 'owner' });
    const { fetchStub } = stubFetch({
      'GET /assistant/skills': list(skill),
      [`GET /assistant/skills/${ASSISTANT_IDS.skill}`]: { status: 200, body: skill },
      [`GET /assistant/skills/${ASSISTANT_IDS.skill}/events`]: list(skillEventFixture()),
      [`POST /assistant/skill-events/${ASSISTANT_IDS.skillEvent}/undo`]: {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'x',
            traceId: 't',
            details: { reason: 'stale_skill' },
          },
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantSkills />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /bao-gia-si/ }));
    await user.click(await screen.findByRole('button', { name: 'Hoàn tác' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Kỹ năng đã đổi sau thay đổi này nên không hoàn tác được.',
      ),
    );
  });

  it('customises a platform skill into a shadow, which can go back to the original', async () => {
    const platformRef = `GET /assistant/skills/${encodeURIComponent('platform:tao-don')}`;
    const shadow = skillFixture({
      id: ASSISTANT_IDS.skill2,
      ref: ASSISTANT_IDS.skill2,
      name: 'tao-don',
      description: 'Tạo đơn hàng mới',
      provenance: 'shadow',
      shadowOf: 'tao-don',
      state: 'active',
      body: 'Mở trang Đơn hàng rồi bấm Tạo đơn.',
    });
    const routes: Routes = {
      'GET /assistant/skills': list(platformSkillFixture()),
      [platformRef]: { status: 200, body: platformSkillFixture() },
      'POST /assistant/skills/platform/tao-don/shadow': { status: 201, body: shadow },
      [`GET /assistant/skills/${ASSISTANT_IDS.skill2}`]: { status: 200, body: shadow },
      [`GET /assistant/skills/${ASSISTANT_IDS.skill2}/events`]: list(
        skillEventFixture({ skillId: ASSISTANT_IDS.skill2, actor: 'owner', action: 'create' }),
      ),
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantSkills />);
    const user = userEvent.setup();

    const builtIn = await screen.findByRole('region', { name: 'Có sẵn' });
    await user.click(within(builtIn).getByRole('button', { name: /tao-don/ }));
    // A platform skill is read-only: its body shows, with no form.
    expect(await screen.findByText('Mở trang Đơn hàng rồi bấm Tạo đơn.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument();

    routes['GET /assistant/skills'] = list(platformSkillFixture({ shadowed: true }), shadow);
    await user.click(screen.getByRole('button', { name: 'Tinh chỉnh' }));

    expect(await screen.findByRole('button', { name: 'Khôi phục bản gốc' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nội dung')).toHaveValue('Mở trang Đơn hàng rồi bấm Tạo đơn.');
    expect(calls.filter((c) => c.key.endsWith('/shadow'))).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith('Đã tạo bản tinh chỉnh. Trợ lý sẽ dùng bản này.');

    // Back on the list, the platform entry is the owner's copy.
    await user.click(screen.getByRole('button', { name: 'Tất cả kỹ năng' }));
    const after = await screen.findByRole('region', { name: 'Có sẵn' });
    expect(within(after).getByText('Đã tinh chỉnh')).toBeInTheDocument();
  });

  it('saves an edited skill: only what changed is sent', async () => {
    const skill = skillFixture({ state: 'active', provenance: 'owner' });
    const patch = `PATCH /assistant/skills/${ASSISTANT_IDS.skill}`;
    const { fetchStub, calls } = stubFetch({
      'GET /assistant/skills': list(skill),
      [`GET /assistant/skills/${ASSISTANT_IDS.skill}`]: { status: 200, body: skill },
      [`GET /assistant/skills/${ASSISTANT_IDS.skill}/events`]: list(),
      [patch]: { status: 200, body: { ...skill, body: 'Giảm 12%.' } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantSkills />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /bao-gia-si/ }));
    const body = await screen.findByLabelText('Nội dung');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    await user.clear(body);
    await user.type(body, 'Giảm 12%.');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã lưu kỹ năng.'));
    expect(calls.find((c) => c.key === patch)?.body).toEqual({ body: 'Giảm 12%.' });
  });

  it('restores an archived skill', async () => {
    const archived = skillFixture({ state: 'archived', provenance: 'owner' });
    const restore = `POST /assistant/skills/${ASSISTANT_IDS.skill}/restore`;
    const { fetchStub, calls } = stubFetch({
      'GET /assistant/skills': list(archived),
      [`GET /assistant/skills/${ASSISTANT_IDS.skill}`]: { status: 200, body: archived },
      [`GET /assistant/skills/${ASSISTANT_IDS.skill}/events`]: list(),
      [restore]: { status: 200, body: { ...archived, state: 'active' } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantSkills />);
    const user = userEvent.setup();

    const archive = await screen.findByRole('region', { name: 'Lưu trữ' });
    await user.click(within(archive).getByRole('button', { name: /bao-gia-si/ }));
    await user.click(await screen.findByRole('button', { name: 'Khôi phục' }));
    await waitFor(() => expect(calls.some((c) => c.key === restore)).toBe(true));
  });
});
