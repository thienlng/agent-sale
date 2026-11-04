import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders } from '@/testing/render';

import { AssistantMarkdown } from './assistant-markdown';

beforeAll(() => loadNamespace('assistant'));

describe('AssistantMarkdown', () => {
  it('renders bold, italic and inline code, with line breaks kept', () => {
    const { container } = render(
      <AssistantMarkdown content={'Có **60** sản phẩm, *đang bán* `SP-01`\ndòng hai'} />,
    );
    expect(screen.getByText('60').tagName).toBe('STRONG');
    expect(screen.getByText('đang bán').tagName).toBe('EM');
    expect(screen.getByText('SP-01').tagName).toBe('CODE');
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.textContent).not.toContain('**');
  });

  it('renders bullet and numbered lists', () => {
    render(<AssistantMarkdown content={'Gợi ý:\n- Một\n- **Hai**\n\n3. Ba\n4. Bốn'} />);
    const [ul, ol] = screen.getAllByRole('list') as [HTMLElement, HTMLElement];
    expect(ul.tagName).toBe('UL');
    expect(within(ul).getAllByRole('listitem')).toHaveLength(2);
    expect(ol.tagName).toBe('OL');
    expect(ol).toHaveAttribute('start', '3');
    expect(
      within(ol)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Ba', 'Bốn']);
  });

  it('renders a GFM table with header, rows and alignment', () => {
    render(
      <AssistantMarkdown
        content={
          'Tồn kho:\n| Mã | Tên | Tồn |\n|---|---|---:|\n| A1 | Xe **gỗ** | 5 |\n| A2 | Bóng \\| đỏ | 0 |'
        }
      />,
    );
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Mã', 'Tên', 'Tồn']);
    const rows = within(table).getAllByRole('row') as [HTMLElement, HTMLElement, HTMLElement];
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('gỗ').tagName).toBe('STRONG');
    expect(within(rows[2]).getByText('Bóng | đỏ')).toBeInTheDocument();
    expect(within(rows[1]).getByText('5')).toHaveClass('text-right');
  });

  it('shows a quoted raw status as its label, in text and in table cells', () => {
    const { container } = renderWithProviders(
      <AssistantMarkdown
        content={
          'Trạng thái là `awaiting_owner_approval`.\n\n| Đơn | Trạng thái |\n|---|---|\n| DH-1 | cancelled |\n| DH-2 | `new` |'
        }
      />,
    );
    expect(container.textContent).toContain('Trạng thái là Chờ anh/chị duyệt.');
    expect(container.textContent).not.toMatch(/awaiting_owner_approval|cancelled|`new`/);
    expect(container.querySelector('code')).toBeNull();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]?.textContent).toBe('DH-1Đã huỷ');
    expect(rows[2]?.textContent).toBe('DH-2Mới');
  });

  it('keeps a raw status the owner asked to see as a code, never the label twice (ST2)', () => {
    renderWithProviders(
      <AssistantMarkdown
        content={
          '| Trạng thái | Mã trạng thái | Số đơn |\n|---|---|---|\n| Đã hủy | `cancelled` | 3 |\n| Mới | new | 1 |\n\n| Nhãn | Trạng thái |\n|---|---|\n| **Đã huỷ** | cancelled |'
        }
      />,
    );
    const [asked, both] = screen.getAllByRole('table') as [HTMLElement, HTMLElement];
    const rows = within(asked).getAllByRole('row');
    // The code column keeps the codes; the model's own label column is left as written.
    expect(rows[1]?.textContent).toBe('Đã hủycancelled3');
    expect(rows[2]?.textContent).toBe('Mớinew1');
    expect(within(asked).getByText('cancelled').tagName).toBe('CODE');
    // The row already shows the label (another spelling): the code is not relabelled.
    expect(within(both).getAllByRole('row')[1]?.textContent).toBe('Đã huỷcancelled');
  });

  it('keeps a one-word cell on one line and lets a wide table scroll', () => {
    render(
      <AssistantMarkdown
        content={'| Mã | Sản phẩm |\n|---|---|\n| JS-038 | Bàn đập chốt gỗ cho bé |'}
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('JS-038')).toHaveClass('whitespace-nowrap');
    expect(within(table).getByText('Bàn đập chốt gỗ cho bé')).not.toHaveClass('whitespace-nowrap');
    expect(table.parentElement).toHaveClass('overflow-x-auto');
  });

  it('keeps raw HTML as text', () => {
    const { container } = render(
      <AssistantMarkdown content={'<img src=x onerror="alert(1)"> <script>bad()</script>'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('links only to dashboard paths; other targets show the label alone', () => {
    const { container } = render(
      <AssistantMarkdown
        content={
          '[Đơn hàng](/app/orders) [lừa](javascript:alert(1)) [ngoài](https://evil.test) [thoát](/app/../admin)'
        }
      />,
    );
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/app/orders');
    expect(container.textContent).toContain('lừa');
    expect(container.textContent).toContain('ngoài');
    expect(container.textContent).not.toContain('evil.test');
    expect(container.textContent).not.toContain('javascript');
  });

  it('renders a fenced code block verbatim', () => {
    const { container } = render(<AssistantMarkdown content={'```\n**not bold**\n```'} />);
    expect(container.querySelector('pre code')?.textContent).toBe('**not bold**');
    expect(container.querySelector('strong')).toBeNull();
  });
});
