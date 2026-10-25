import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { suggestTags, TagBar, type LibraryTag } from './tag-bar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const T = 'channelInbox.v2.tagBar.';
const library: LibraryTag[] = [
  { id: 'a', name: 'Hỏi giá', color: '#2563eb', activeCount: 3 },
  { id: 'b', name: 'VIP', color: '#f26b1d', activeCount: 40 },
  { id: 'c', name: 'Đã cọc', color: '#16a34a', activeCount: 0 },
  { id: 'd', name: 'Ship gấp', color: '#dc2626' },
];
const applied = [{ id: 'c', name: 'Đã cọc', color: '#16a34a', assignmentId: 'as-c' }];

function setup(props: Partial<React.ComponentProps<typeof TagBar>> = {}) {
  const handlers = {
    onAttach: vi.fn(),
    onRemove: vi.fn(),
    onExpandedChange: vi.fn(),
    onPickerOpenChange: vi.fn(),
  };
  const view = render(
    <TagBar
      tags={applied}
      library={library}
      expanded={false}
      pickerOpen={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

describe('suggestTags', () => {
  it('suggests unused tags, most used first, library order as the tie-break', () => {
    expect(suggestTags(library, applied).map((t) => t.id)).toEqual(['b', 'a', 'd']);
  });
});

describe('tag bar', () => {
  it('shows applied tags first with a remove button, then suggestions', () => {
    setup();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Đã cọc', 'VIP', 'Hỏi giá', 'Ship gấp']);
    expect(screen.getByRole('button', { name: `${T}remove Đã cọc` })).toBeInTheDocument();
  });

  it('keeps the bar on one line until expanded', () => {
    const { rerender, ...rest } = setup();
    expect(screen.getByRole('list').className).toContain('max-h-6');
    rerender(
      <TagBar
        tags={applied}
        library={library}
        expanded
        pickerOpen={false}
        onAttach={rest.onAttach}
        onRemove={rest.onRemove}
        onExpandedChange={rest.onExpandedChange}
        onPickerOpenChange={rest.onPickerOpenChange}
      />,
    );
    expect(screen.getByRole('list').className).not.toContain('max-h-6');
  });

  it('attaches a suggested tag in one click', async () => {
    const user = userEvent.setup();
    const { onAttach } = setup();
    await user.click(screen.getByRole('button', { name: `${T}attach VIP` }));
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('removes an applied tag by its assignment', async () => {
    const user = userEvent.setup();
    const { onRemove } = setup();
    await user.click(screen.getByRole('button', { name: `${T}remove Đã cọc` }));
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c', assignmentId: 'as-c' }),
    );
  });

  it('opens a searchable picker with every tag and its check state', async () => {
    const user = userEvent.setup();
    setup({ pickerOpen: true });
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(4);
    expect(
      options.filter((o) => o.getAttribute('data-checked') === 'true').map((o) => o.textContent),
    ).toEqual(['Đã cọc']);
    await user.type(screen.getByPlaceholderText(`${T}search`), 'ship');
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('toggles tags from the picker', async () => {
    const user = userEvent.setup();
    const { onAttach, onRemove } = setup({ pickerOpen: true });
    await user.click(await screen.findByRole('option', { name: 'Ship gấp' }));
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ id: 'd' }));
    await user.click(screen.getByRole('option', { name: 'Đã cọc' }));
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c', assignmentId: 'as-c' }),
    );
  });

  it('asks the parent to open the picker and to expand', async () => {
    const user = userEvent.setup();
    const { onPickerOpenChange, onExpandedChange } = setup();
    await user.click(screen.getByRole('button', { name: `${T}addLabel` }));
    expect(onPickerOpenChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: `${T}expand` }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('cannot change tags without permission', () => {
    setup({ readOnly: true });
    expect(screen.queryByRole('button', { name: `${T}remove Đã cọc` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${T}attach VIP` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${T}addLabel` })).not.toBeInTheDocument();
  });

  it('disables the picker items while a tag change is in flight', async () => {
    setup({ pickerOpen: true, busy: true });
    for (const option of await screen.findAllByRole('option'))
      expect(option).toHaveAttribute('aria-disabled', 'true');
  });

  it('links to the CRM tag settings when the library is empty', async () => {
    setup({ pickerOpen: true, library: [], tags: [] });
    expect(await screen.findByRole('link', { name: `${T}create` })).toHaveAttribute(
      'href',
      '/app/crm-settings/tags',
    );
  });
});
