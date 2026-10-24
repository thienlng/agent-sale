import type { TagDto } from '@agent-sales/contracts';
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useCrmTags, useTagDefinitionMutations } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';
import { TagChip } from './crm-badges';
import { TagDialog } from './tag-dialog';

/** Tag definitions: name, color, type, fields, who created it, usage (CRM-04). */
export function TagsManager() {
  const { t } = useTranslation();
  const tags = useCrmTags();
  const { update } = useTagDefinitionMutations();
  const [editing, setEditing] = useState<TagDto | 'new' | null>(null);
  if (!tags.data) return <Skeleton className="h-64 rounded-xl" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus />
          {t('crm.tags.create')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('crm.tags.name')}</TableHead>
              <TableHead>{t('crm.tags.type')}</TableHead>
              <TableHead>{t('crm.tags.fields')}</TableHead>
              <TableHead>{t('crm.tags.active')}</TableHead>
              <TableHead>{t('crm.tags.createdBy')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('crm.tags.description')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.data.map((tag) => (
              <TableRow key={tag.id} className={tag.archived ? 'opacity-60' : undefined}>
                <TableCell>
                  <TagChip name={tag.name} color={tag.color} />
                  {tag.archived ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('crm.settings.archived')}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{t(`crm.tags.types.${tag.type}`)}</TableCell>
                <TableCell className="tabular-nums">
                  {t('crm.tags.fieldsCount', {
                    count: tag.fields.filter((f) => !f.archived).length,
                  })}
                </TableCell>
                <TableCell className="tabular-nums">{tag.activeCount}</TableCell>
                <TableCell>
                  {tag.isSystem ? t('crm.tags.system') : (tag.createdByName ?? '—')}
                </TableCell>
                <TableCell className="hidden max-w-64 truncate text-muted-foreground lg:table-cell">
                  {tag.description || '—'}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('crm.tags.edit')}: ${tag.name}`}
                      onClick={() => setEditing(tag)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t(tag.archived ? 'crm.settings.restore' : 'crm.settings.archive')}: ${tag.name}`}
                      onClick={() =>
                        update.mutate(
                          {
                            id: tag.id,
                            body: { archived: !tag.archived, expectedVersion: tag.version },
                          },
                          { onError: (err) => toast.error(crmErrorMessage(t, err)) },
                        )
                      }
                    >
                      {tag.archived ? <ArchiveRestore /> : <Archive />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <TagDialog tag={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
