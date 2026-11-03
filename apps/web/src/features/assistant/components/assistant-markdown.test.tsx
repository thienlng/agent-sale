import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssistantMarkdown } from './assistant-markdown';

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
