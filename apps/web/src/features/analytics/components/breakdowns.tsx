import type { AnalyticsResponse, DrilldownDimension, MetricKey } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber } from '@/lib/format';

type Opener = (metric: MetricKey, dimension: DrilldownDimension, label: string) => void;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border p-4">
      <h2 className="font-semibold">{title}</h2>
      {note ? <p className="mt-1 text-sm text-muted-foreground">{note}</p> : null}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}

/** A row that opens the customers behind it (a number is only worth trusting if you can see its rows). */
function Pick({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="max-w-56 truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export interface Names {
  tag: (id: string) => string;
  status: (id: string | null) => string;
  member: (id: string | null) => string;
  page: (id: string | null) => string;
}

/** Tag events, current tags, statuses, and per salesperson / page rows — each opening its drilldown. */
export function Breakdowns({
  tagStatus,
  people,
  conversations,
  names,
  onOpen,
}: {
  tagStatus: AnalyticsResponse | undefined;
  people: AnalyticsResponse | undefined;
  conversations: AnalyticsResponse | undefined;
  names: Names;
  onOpen: Opener;
}) {
  const { t } = useTranslation();
  const b = tagStatus?.breakdowns;
  const salesRows = people?.breakdowns.bySales ?? [];
  const pageRows = conversations?.breakdowns.byPage ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {b?.tags.length ? (
        <Section title={t('analytics.breakdowns.topTags')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('analytics.metrics.tags.assigned.name')}</TableHead>
                <TableHead className="text-right">{t('analytics.breakdowns.assigned')}</TableHead>
                <TableHead className="text-right">{t('analytics.breakdowns.removed')}</TableHead>
                <TableHead className="text-right">{t('analytics.breakdowns.net')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.tags.map((r) => (
                <TableRow key={r.tagId}>
                  <TableCell>
                    <Pick
                      label={names.tag(r.tagId)}
                      onClick={() =>
                        onOpen('tags.assigned', { tagId: r.tagId }, names.tag(r.tagId))
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.assigned)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.removed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.net)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {b?.currentTags.length ? (
        <Section
          title={t('analytics.breakdowns.currentTags')}
          note={t('analytics.breakdowns.currentTagsNote', {
            count: tagStatus?.distinctTotals['tags.current'] ?? 0,
          })}
        >
          <Table>
            <TableBody>
              {b.currentTags.map((r) => (
                <TableRow key={r.tagId}>
                  <TableCell>
                    <Pick
                      label={names.tag(r.tagId)}
                      onClick={() => onOpen('tags.current', { tagId: r.tagId }, names.tag(r.tagId))}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {b?.statuses.length ? (
        <Section title={t('analytics.breakdowns.statuses')}>
          <Table>
            <TableBody>
              {b.statuses.map((r) => (
                <TableRow key={r.statusId ?? 'none'}>
                  <TableCell>
                    <Pick
                      label={names.status(r.statusId)}
                      onClick={() =>
                        onOpen(
                          'statuses.current',
                          { statusId: r.statusId },
                          names.status(r.statusId),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {salesRows.length ? (
        <Section title={t('analytics.breakdowns.bySales')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('analytics.filters.sales')}</TableHead>
                <TableHead className="text-right">
                  {t('analytics.metrics.customers.new.name')}
                </TableHead>
                <TableHead className="text-right">
                  {t('analytics.metrics.phones.captured.name')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {salesRows.map((r) => (
                <TableRow key={r.salesUserId ?? 'none'}>
                  <TableCell>
                    <Pick
                      label={names.member(r.salesUserId)}
                      onClick={() =>
                        onOpen(
                          'customers.new',
                          { salesUserId: r.salesUserId },
                          names.member(r.salesUserId),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.values['customers.new'] ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.values['phones.captured'] ?? 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {pageRows.length ? (
        <Section title={t('analytics.breakdowns.byPage')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('analytics.filters.page')}</TableHead>
                <TableHead className="text-right">
                  {t('analytics.metrics.conversations.opened.name')}
                </TableHead>
                <TableHead className="text-right">
                  {t('analytics.metrics.messages.inbound.name')}
                </TableHead>
                <TableHead className="text-right">
                  {t('analytics.metrics.messages.outbound.name')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((r) => (
                <TableRow key={r.channelId ?? 'none'}>
                  <TableCell>
                    <Pick
                      label={names.page(r.channelId)}
                      onClick={() =>
                        onOpen(
                          'messages.inbound',
                          { channelId: r.channelId },
                          names.page(r.channelId),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.values['conversations.opened'] ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.values['messages.inbound'] ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.values['messages.outbound'] ?? 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </div>
  );
}
