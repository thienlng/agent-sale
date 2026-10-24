import {
  CONTACT_HISTORY_TYPES,
  type ContactHistoryEntry,
  type ContactHistoryType,
} from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDateTime } from '@/lib/format';

import { useHistory } from '../api/crm';
import type { CrmLookups } from '../hooks/use-crm-lookups';

const ALL = '__all';

/** A field value as the user knows it (option and member names, not ids). */
function shown(field: string, v: unknown, lookups: CrmLookups, t: TFunction): string {
  if (v === null || v === undefined || v === '') return t('crm.history.empty_value');
  const s = String(v);
  if (field === 'sourceId') return lookups.source(s)?.name ?? s;
  if (field === 'statusId') return lookups.status(s)?.name ?? s;
  if (field === 'salesUserId' || field === 'careUserId') return lookups.member(s) ?? s;
  if (field === 'gender') return t(`crm.field.genders.${s}`);
  return s;
}

const fieldName = (field: string, t: TFunction) =>
  field === 'body'
    ? t('crm.detail.notes')
    : t(`crm.col.${field.replace(/UserId$/, '').replace(/Id$/, '')}`);

function Entry({ e, lookups }: { e: ContactHistoryEntry; lookups: CrmLookups }) {
  const { t } = useTranslation();
  const tagName = typeof e.data['tagName'] === 'string' ? e.data['tagName'] : null;
  return (
    <li className="relative">
      <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-border ring-4 ring-background" />
      <div className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-medium">{t(`crm.history.type.${e.type}`)}</span>
        {tagName ? <span>· {tagName}</span> : null}
        <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(e.at)}</span>
        {e.actorName ? (
          <span className="text-xs text-muted-foreground">· {e.actorName}</span>
        ) : null}
      </div>
      {Object.keys(e.changes).length ? (
        <dl className="mt-1 grid gap-0.5 text-xs">
          {Object.entries(e.changes).map(([field, c]) => (
            <div key={field} className="flex flex-wrap gap-1">
              <dt className="text-muted-foreground">{fieldName(field, t)}:</dt>
              <dd>
                <span className="text-muted-foreground line-through">
                  {shown(field, c.from, lookups, t)}
                </span>
                {' → '}
                <span>{shown(field, c.to, lookups, t)}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : e.type === 'note.added' && typeof e.data['body'] === 'string' ? (
        <p className="mt-1 line-clamp-3 text-xs whitespace-pre-line text-muted-foreground">
          {e.data['body']}
        </p>
      ) : null}
    </li>
  );
}

/** Audit timeline with type filter and order (CRM-01). */
export function ContactHistoryTab({
  contactId,
  lookups,
}: {
  contactId: string;
  lookups: CrmLookups;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<ContactHistoryType | undefined>(undefined);
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const history = useHistory(contactId, { type, order });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Select
          value={type ?? ALL}
          onValueChange={(v) => setType(v === ALL ? undefined : (v as ContactHistoryType))}
        >
          <SelectTrigger className="h-9 w-48" aria-label={t('crm.history.allTypes')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('crm.history.allTypes')}</SelectItem>
            {CONTACT_HISTORY_TYPES.map((x) => (
              <SelectItem key={x} value={x}>
                {t(`crm.history.type.${x}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={order} onValueChange={(v) => setOrder(v as 'desc' | 'asc')}>
          <SelectTrigger className="h-9 w-40" aria-label={t('crm.history.newest')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">{t('crm.history.newest')}</SelectItem>
            <SelectItem value="asc">{t('crm.history.oldest')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {history.isPending ? (
        <Skeleton className="h-40" />
      ) : history.data?.length ? (
        <ol className="relative ml-2 flex flex-col gap-4 border-l pl-5">
          {history.data.map((e) => (
            <Entry key={e.id} e={e} lookups={lookups} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{t('crm.history.empty')}</p>
      )}
    </div>
  );
}
