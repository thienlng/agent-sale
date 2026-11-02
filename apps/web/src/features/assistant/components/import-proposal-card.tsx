import type { AssistantProposalDto, ImportBatchDto, ImportDraftDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronDown, EyeOff, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useImportBatch } from '../api/imports';
import { ImportTable, problemLabel } from './import-table';
import { useProposalDecision } from './proposal-decision';

/** What a `product_import` proposal pins in its preview (spec §6.2). */
interface ImportPreview {
  fileName: string;
  batchKind: 'sheet' | 'photos';
  draftKeys: string[];
  /** The hash of the drafts the proposal was made from; approval refuses any other. */
  draftsHash: string | null;
  counts: { products: number; variants: number; skippedWithErrors: number; alreadyCreated: number };
  visibleToBotDefault: boolean;
}

function readPreview(preview: unknown): ImportPreview {
  const p = (preview && typeof preview === 'object' ? preview : {}) as Partial<ImportPreview>;
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    fileName: typeof p.fileName === 'string' ? p.fileName : '',
    batchKind: p.batchKind === 'photos' ? 'photos' : 'sheet',
    draftKeys: Array.isArray(p.draftKeys) ? p.draftKeys.filter((k) => typeof k === 'string') : [],
    draftsHash: typeof p.draftsHash === 'string' ? p.draftsHash : null,
    counts: {
      products: n(p.counts?.products),
      variants: n(p.counts?.variants),
      skippedWithErrors: n(p.counts?.skippedWithErrors),
      alreadyCreated: n(p.counts?.alreadyCreated),
    },
    visibleToBotDefault: p.visibleToBotDefault !== false,
  };
}

/** `Dòng 3` (source row + 1, as people count) or `Ảnh 2`. */
function draftPlace(t: ReturnType<typeof useTranslation<'assistant'>>['t'], d: ImportDraftDto) {
  const photo = /^p(\d+)$/.exec(d.key);
  if (photo) return t('import.card.photo', { n: Number(photo[1]) + 1 });
  return t('import.card.row', { row: (d.rows[0] ?? Number(d.key.slice(1))) + 1 });
}

const hasErrors = (d: ImportDraftDto) => d.problems.some((p) => p.severity === 'error');

/** The rows skipped for errors, each with its place and reasons. */
function SkippedList({ drafts }: { drafts: readonly ImportDraftDto[] }) {
  const { t } = useTranslation('assistant');
  const [open, setOpen] = useState(false);
  if (drafts.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-fit items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {t('import.card.skipped', { count: drafts.length })}
        <ChevronDown
          className={cn('size-3 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-auto text-xs">
          {drafts.map((d) => (
            <li key={d.key}>
              <span className="font-medium">{draftPlace(t, d)}</span>
              {d.product?.name ? ` · ${d.product.name}` : ''}
              {': '}
              {d.problems
                .filter((p) => p.severity === 'error')
                .map((p) => problemLabel(t, p.code))
                .join(', ')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Once decided: created (with links), failed with reasons, and not run. */
function ImportReport({ batch, keys }: { batch: ImportBatchDto; keys: readonly string[] }) {
  const { t } = useTranslation('assistant');
  const drafts = new Map((batch.drafts ?? []).map((d) => [d.key, d]));
  const rows = keys.flatMap((k) => {
    const result = batch.results[k];
    const draft = drafts.get(k);
    return result && draft ? [{ key: k, draft, result }] : [];
  });
  const created = rows.filter((r) => r.result.status === 'created');
  const failed = rows.filter((r) => r.result.status === 'failed');
  const notRun = rows.filter((r) => r.result.status === 'not_run');
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <p className="font-medium">
        {t('import.card.report', {
          created: created.length,
          failed: failed.length,
          notRun: notRun.length,
        })}
      </p>
      {created.length ? (
        <ul
          className="flex max-h-32 flex-col gap-0.5 overflow-auto"
          aria-label={t('import.card.created')}
        >
          {created.map(({ key, draft, result }) => (
            <li key={key}>
              {result.status === 'created' ? (
                <Link
                  to="/app/products/$productId"
                  params={{ productId: result.productId }}
                  className="text-primary underline-offset-2 hover:underline"
                  aria-label={t('import.card.open', { name: draft.product?.name ?? key })}
                >
                  {draft.product?.name ?? key}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {failed.length ? (
        <ul className="flex flex-col gap-0.5 text-destructive" aria-label={t('import.card.failed')}>
          {failed.map(({ key, draft, result }) => (
            <li key={key}>
              <span className="font-medium">{draftPlace(t, draft)}</span>
              {draft.product?.name ? ` · ${draft.product.name}` : ''}
              {': '}
              {result.status === 'failed' ? problemLabel(t, result.errorCode) : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {notRun.length ? (
        <p className="text-muted-foreground">
          {t('import.card.notRun')}: {notRun.map(({ draft }) => draftPlace(t, draft)).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A `product_import` proposal (T-173): "Tạo N sản phẩm từ <file>", the counts, the bot-visibility
 * note, the table of products and the skipped rows; Áp dụng / Bỏ while pending, then the report
 * of what was created. The batch is refetched after a decision. While the batch's drafts are not
 * the ones the proposal pinned (another preview came after it, or the cached batch is older than
 * the proposal), Áp dụng stays blocked: the card must never show rows the approval would not create.
 */
export function ImportProposalCard({ proposal }: { proposal: AssistantProposalDto }) {
  const { t } = useTranslation('assistant');
  const preview = readPreview(proposal.preview);
  const batch = useImportBatch(proposal.importBatchId);
  const { inFlight, run } = useProposalDecision(proposal);
  const [showTable, setShowTable] = useState(false);
  const pending = proposal.status === 'pending';
  const decided = proposal.status === 'done' || proposal.status === 'failed';

  // The results are written while the import runs: read them again once it is decided.
  const { refetch } = batch;
  useEffect(() => {
    if (decided) void refetch();
  }, [decided, refetch]);

  // The drafts on screen differ from the ones the proposal pinned: read the batch again, and
  // block Áp dụng until they match.
  const stale = pending && batch.data !== undefined && batch.data.draftsHash !== preview.draftsHash;
  useEffect(() => {
    if (stale) void refetch();
  }, [stale, refetch]);

  const drafts = batch.data?.drafts ?? [];
  const chosen = new Set(preview.draftKeys);
  const toCreate = drafts.filter((d) => chosen.has(d.key));
  const skipped = drafts.filter(
    (d) => !d.excluded && hasErrors(d) && batch.data?.results[d.key]?.status !== 'created',
  );
  const busy = inFlight !== null;
  const applying = inFlight === 'approve';
  const tableId = `import-table-${proposal.id}`;

  return (
    <li
      className="flex w-[92%] min-w-0 flex-col gap-2 self-start rounded-xl border border-primary/30 bg-primary-soft/40 px-3 py-2.5"
      aria-label={t('proposals.label')}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          {t('proposals.label')}
        </p>
        <p className="mt-1 font-medium break-words">
          {t('import.card.title', { count: preview.counts.products, file: preview.fileName })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('import.card.counts', {
            products: preview.counts.products,
            variants: preview.counts.variants,
          })}
          {preview.counts.skippedWithErrors
            ? ` · ${t('import.card.skippedCount', { count: preview.counts.skippedWithErrors })}`
            : ''}
          {preview.counts.alreadyCreated
            ? ` · ${t('import.card.alreadyCreated', { count: preview.counts.alreadyCreated })}`
            : ''}
        </p>
        {!preview.visibleToBotDefault ? (
          <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
            <EyeOff className="mt-0.5 size-3 shrink-0" aria-hidden />
            {t('import.card.visibleOff')}
          </p>
        ) : null}
        <p className="mt-1 text-xs break-words text-muted-foreground">{proposal.summary}</p>
      </div>

      {batch.isPending && proposal.importBatchId ? (
        <p className="text-xs text-muted-foreground">{t('import.card.loading')}</p>
      ) : batch.isError ? (
        <p className="text-xs text-destructive">{t('import.card.loadError')}</p>
      ) : (
        <>
          {toCreate.length ? (
            <>
              <button
                type="button"
                aria-expanded={showTable}
                aria-controls={tableId}
                onClick={() => setShowTable((v) => !v)}
                className="inline-flex w-fit items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {showTable ? t('import.card.hideTable') : t('import.card.showTable')}
                <ChevronDown
                  className={cn('size-3 transition-transform', showTable && 'rotate-180')}
                  aria-hidden
                />
              </button>
              {showTable ? (
                <div id={tableId}>
                  <ImportTable drafts={toCreate} />
                </div>
              ) : null}
            </>
          ) : null}
          {pending ? <SkippedList drafts={skipped} /> : null}
          {decided && batch.data ? (
            <ImportReport batch={batch.data} keys={preview.draftKeys} />
          ) : null}
        </>
      )}

      {stale ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t('import.card.changed')}
        </p>
      ) : null}
      {pending ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || stale || batch.data === undefined}
            onClick={() => run('approve')}
          >
            {applying ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {applying ? t('proposals.applying') : t('proposals.apply')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('reject')}>
            {t('proposals.reject')}
          </Button>
        </div>
      ) : (
        <p
          className={cn(
            'text-xs',
            proposal.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {t(`proposals.status.${proposal.status}`, { code: proposal.errorCode ?? '' })}
        </p>
      )}
    </li>
  );
}
