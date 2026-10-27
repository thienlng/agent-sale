import type { ContactDto, TagAssignmentDto, TagDto } from '@agent-sales/contracts';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { TagValuesDialog } from '@/components/tag-values-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTagMutations } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';
import type { CrmLookups } from '../hooks/use-crm-lookups';
import { TagChip } from './crm-badges';

function valueText(tag: TagDto, a: TagAssignmentDto, t: (k: string) => string): string {
  return tag.fields
    .flatMap((f) => {
      const v = a.values[f.key];
      if (v === undefined || v === null || v === '') return [];
      const shown =
        f.type === 'select'
          ? (f.options.find((o) => o.id === v)?.label ?? String(v))
          : f.type === 'boolean'
            ? t(v ? 'crm.tags.yes' : 'crm.tags.no')
            : String(v);
      return [`${f.label}: ${shown}`];
    })
    .join(' · ');
}

/** Tags on a customer: chips with values, add from a searchable list, remove. */
export function ContactTags({
  contact,
  lookups,
  readOnly = false,
}: {
  contact: ContactDto;
  lookups: CrmLookups;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { assign, update, remove } = useTagMutations(contact.id);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ tag: TagDto; assignment?: TagAssignmentDto } | null>(
    null,
  );
  const activeIds = new Set(contact.tags.map((a) => a.tagId));
  const choices = lookups.tags.filter(
    (tag) => !tag.archived && (tag.type === 'work' || !activeIds.has(tag.id)),
  );
  const fail = (err: unknown) => toast.error(crmErrorMessage(t, err));

  const add = (tag: TagDto) => {
    setOpen(false);
    if (tag.fields.some((f) => !f.archived)) {
      setEditing({ tag });
      return;
    }
    assign.mutate(
      { tagId: tag.id },
      { onSuccess: () => toast.success(t('crm.detail.tagAdded')), onError: fail },
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('crm.detail.tags')}</h3>
        {readOnly ? null : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus />
                {t('crm.detail.addTag')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
              <Command>
                <CommandInput placeholder={t('crm.tags.search')} />
                <CommandList>
                  <CommandEmpty>—</CommandEmpty>
                  <CommandGroup>
                    {choices.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={`${tag.name} ${tag.id}`}
                        onSelect={() => add(tag)}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                          aria-hidden
                        />
                        <span className="truncate">{tag.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t(`crm.tags.types.${tag.type}`)}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {contact.tags.length ? (
        <ul className="flex flex-col gap-1.5">
          {contact.tags.map((a) => {
            const tag = lookups.tag(a.tagId);
            if (!tag) return null;
            const details = valueText(tag, a, t);
            return (
              <li key={a.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                  disabled={readOnly || !tag.fields.length}
                  onClick={() => setEditing({ tag, assignment: a })}
                >
                  <TagChip name={tag.name} color={tag.color} />
                  {details ? (
                    <span className="truncate text-xs text-muted-foreground">{details}</span>
                  ) : null}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={readOnly ? 'hidden' : undefined}
                  aria-label={t('crm.detail.removeTag', { name: tag.name })}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(a.id, {
                      onSuccess: () => toast.success(t('crm.detail.tagRemoved')),
                      onError: fail,
                    })
                  }
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('crm.detail.noTags')}</p>
      )}
      {editing ? (
        <TagValuesDialog
          tag={editing.tag}
          initial={editing.assignment?.values ?? {}}
          pending={assign.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            const done = { onSuccess: () => setEditing(null), onError: fail };
            if (editing.assignment) {
              update.mutate(
                { id: editing.assignment.id, values, expectedVersion: editing.assignment.version },
                done,
              );
            } else {
              assign.mutate(
                { tagId: editing.tag.id, values },
                {
                  ...done,
                  onSuccess: () => {
                    toast.success(t('crm.detail.tagAdded'));
                    setEditing(null);
                  },
                },
              );
            }
          }}
        />
      ) : null}
    </section>
  );
}
