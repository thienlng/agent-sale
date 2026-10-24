import type { ContactDto, TagAssignmentDto, TagDto, TagValues } from '@agent-sales/contracts';
import { Plus, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useTagMutations } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';
import type { CrmLookups } from '../hooks/use-crm-lookups';
import { TagChip } from './crm-badges';

const NONE = '__none';

/** The values form of an attribute tag (fields from the tag's schema). */
function TagValuesDialog({
  tag,
  initial,
  onSave,
  onClose,
  pending,
}: {
  tag: TagDto;
  initial: TagValues;
  onSave: (values: TagValues) => void;
  onClose: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<TagValues>(initial);
  const fields = tag.fields.filter((f) => !f.archived);
  const set = (key: string, v: TagValues[string]) => setValues({ ...values, [key]: v });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(values);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('crm.detail.tagValues', { name: tag.name })}</DialogTitle>
          </DialogHeader>
          {fields.map((f) => {
            const id = `tv-${f.key}`;
            const v = values[f.key];
            const label = `${f.label}${f.required ? ' *' : ''}`;
            if (f.type === 'boolean') {
              return (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={v === true} onCheckedChange={(c) => set(f.key, c === true)} />
                  {label}
                </label>
              );
            }
            return (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={id}>{label}</Label>
                {f.type === 'select' ? (
                  <Select
                    value={typeof v === 'string' && v ? v : NONE}
                    onValueChange={(x) => set(f.key, x === NONE ? null : x)}
                  >
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('crm.field.none')}</SelectItem>
                      {f.options
                        .filter((o) => !o.archived || o.id === v)
                        .map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={id}
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    required={f.required}
                    value={v === null || v === undefined ? '' : String(v)}
                    onChange={(e) =>
                      set(
                        f.key,
                        f.type === 'number'
                          ? e.target.value === ''
                            ? null
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}
              </div>
            );
          })}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {t('crm.detail.saveTag')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
