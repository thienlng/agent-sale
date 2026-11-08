import { useRouter } from '@tanstack/react-router';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { safeAppPath } from '@/lib/safe-app-path';

import { statusLabel } from '../utils/status-labels';

/**
 * A safe Markdown subset for assistant answers: paragraphs and line breaks, headings (as bold
 * lines), bullet and numbered lists, GFM tables, fenced code, **bold**, *italic*, `code` and
 * links. Everything becomes React elements, so raw HTML in an answer stays text. A link is a
 * link only when its target stays inside the dashboard (`safeAppPath`); any other target is
 * shown as its label alone. A raw status quoted as `code` or filling a table cell
 * (`awaiting_owner_approval`) shows its Vietnamese label. In tables, a one-word cell (a code such
 * as `JS-038`) never breaks; a table wider than the bubble scrolls sideways.
 */

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { kind: 'code'; text: string };

type Align = 'left' | 'center' | 'right' | null;

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  // `\|` is a literal pipe inside a cell.
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const at = (k: number): string => lines[k] ?? '';
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (
        i < lines.length &&
        !at(i)
          .trim()
          .startsWith(fence[1] ?? '```')
      )
        body.push(at(i++));
      i++; // the closing fence (or the end)
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] ?? '' });
      i++;
      continue;
    }
    const next = lines[i + 1];
    if (
      line.includes('|') &&
      next !== undefined &&
      TABLE_SEPARATOR.test(next) &&
      next.includes('-')
    ) {
      const header = splitRow(line);
      const align = splitRow(next).map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && at(i).includes('|') && at(i).trim() !== '') {
        rows.push(splitRow(at(i++)));
      }
      blocks.push({ kind: 'table', header, align, rows });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (BULLET.test(line) || numbered) {
      const ordered = numbered !== null;
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const current = at(i);
        const match = pattern.exec(current);
        if (match) {
          items.push((ordered ? match[2] : match[1]) ?? '');
          i++;
        } else if (current.trim() !== '' && /^\s{2,}/.test(current) && items.length > 0) {
          // An indented continuation (or a nested item) joins the item above it.
          items[items.length - 1] += `\n${current.trim()}`;
          i++;
        } else break;
      }
      blocks.push({ kind: 'list', ordered, start: Number(numbered?.[1] ?? 1), items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = at(i);
      if (
        current.trim() === '' ||
        FENCE.test(current) ||
        HEADING.test(current) ||
        BULLET.test(current) ||
        NUMBERED.test(current) ||
        (current.includes('|') && TABLE_SEPARATOR.test(at(i + 1)) && at(i + 1).includes('-'))
      ) {
        break;
      }
      paragraph.push(current);
      i++;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}

/** `code`, **bold** / __bold__, *italic* / _italic_ and [label](target), first match wins. */
const INLINE =
  /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)([^*\n]+?)\*|(?<![\p{L}\p{N}])_(?!\s)([^_\n]+?)_(?![\p{L}\p{N}])|\[([^\]\n]+)\]\(([^)\s]+)\)/gu;

function Inline({ text }: { text: string }): ReactNode {
  const router = useRouter({ warn: false });
  const { t } = useTranslation('assistant');
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));
    const [, code, bold1, bold2, italic1, italic2, label, target] = match;
    const key = out.length;
    const status = code !== undefined ? statusLabel(t, code) : null;
    if (status !== null) {
      out.push(status);
    } else if (code !== undefined) {
      out.push(
        <code key={key} className="rounded bg-background/70 px-1 font-mono text-[0.85em]">
          {code}
        </code>,
      );
    } else if (bold1 !== undefined || bold2 !== undefined) {
      out.push(
        <strong key={key} className="font-semibold">
          <Inline text={bold1 ?? bold2 ?? ''} />
        </strong>,
      );
    } else if (italic1 !== undefined || italic2 !== undefined) {
      out.push(
        <em key={key}>
          <Inline text={italic1 ?? italic2 ?? ''} />
        </em>,
      );
    } else if (label !== undefined && target !== undefined) {
      const to = safeAppPath(target);
      out.push(
        to ? (
          <a
            key={key}
            href={to}
            className="font-medium text-brand-text underline underline-offset-2"
            onClick={(event) => {
              if (!router || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              void router.navigate({ href: to });
            }}
          >
            <Inline text={label} />
          </a>
        ) : (
          <Fragment key={key}>
            <Inline text={label} />
          </Fragment>
        ),
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Lines of one block, joined by `<br>` (an answer's single newlines are meant). */
function Lines({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          <Inline text={line} />
        </Fragment>
      ))}
    </>
  );
}

/** A cell that is one word (a code, a number): kept on one line. */
const ONE_WORD = /^\S{1,32}$/;

/** Text compared without accents or case: "Đã hủy" and "Đã huỷ" are the same label. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/giu, 'd').toLowerCase().trim();
}

/** A column the owner asked to see codes in ("Mã trạng thái", "Status code"). */
const CODE_HEADER = /(^|[^\p{L}])(mã|ma|code)([^\p{L}]|$)/iu;

/** What a table cell shows: a raw status's label, the raw code kept as code, or its Markdown. */
type CellView = { label: string } | { code: string } | null;

/**
 * A raw status in a table cell shows its label, unless the raw code is what the row means to
 * show (ST2): its column is a code column, or another cell of the row already shows the label,
 * so the label never appears twice.
 */
function cellView(
  t: (key: string) => string,
  header: readonly string[],
  row: readonly string[],
  j: number,
): CellView {
  const raw = (row[j] ?? '').trim().replace(/^`(.*)`$/, '$1');
  const label = statusLabel(t, raw);
  if (label === null) return null;
  if (CODE_HEADER.test(fold(header[j] ?? ''))) return { code: raw.trim() };
  const folded = fold(label);
  const shown = row.some((other, k) => k !== j && fold(other.replace(/[*_`]/g, '')) === folded);
  return shown ? { code: raw.trim() } : { label };
}

function Cell({ view, text }: { view: CellView; text: string }) {
  if (view && 'label' in view) return view.label;
  if (view) {
    return (
      <code className="rounded bg-background/70 px-1 font-mono text-[0.85em]">{view.code}</code>
    );
  }
  return <Inline text={text} />;
}

function cellClass(text: string, align: Align): string {
  return `${ALIGN_CLASS[align ?? 'left']}${ONE_WORD.test(text.trim()) ? ' whitespace-nowrap' : ''}`;
}

const ALIGN_CLASS: Record<Exclude<Align, null>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export function AssistantMarkdown({ content }: { content: string }) {
  const { t } = useTranslation('assistant');
  const blocks = parseBlocks(content);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return (
              <p key={i} className="font-semibold">
                <Inline text={block.text} />
              </p>
            );
          case 'code':
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-md bg-background/70 p-2 font-mono text-xs whitespace-pre"
              >
                <code>{block.text}</code>
              </pre>
            );
          case 'list': {
            const items = block.items.map((item, j) => (
              <li key={j}>
                <Lines text={item} />
              </li>
            ));
            return block.ordered ? (
              <ol key={i} start={block.start} className="list-decimal space-y-0.5 pl-5">
                {items}
              </ol>
            ) : (
              <ul key={i} className="list-disc space-y-0.5 pl-5">
                {items}
              </ul>
            );
          }
          case 'table':
            return (
              <div key={i} className="max-w-full overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {block.header.map((cell, j) => (
                        <th
                          key={j}
                          className={`border-b px-2 py-1 font-semibold ${cellClass(cell, block.align[j] ?? null)}`}
                        >
                          <Cell view={cellView(t, [], [cell], 0)} text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border/50 last:border-0">
                        {block.header.map((_, j) => (
                          <td
                            key={j}
                            className={`px-2 py-1 align-top ${cellClass(row[j] ?? '', block.align[j] ?? null)}`}
                          >
                            <Cell view={cellView(t, block.header, row, j)} text={row[j] ?? ''} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'paragraph':
            return (
              <p key={i}>
                <Lines text={block.lines.join('\n')} />
              </p>
            );
        }
      })}
    </div>
  );
}
