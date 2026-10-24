import type { TagDto, TagFieldDef, TagType } from '@agent-sales/contracts';
import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { ApiClientError } from '@/lib/api-client';

import { useTagDefinitionMutations } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';

const TYPES: TagType[] = ['classification', 'attribute', 'work'];
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;

/** A field key from its label: lowercase ascii, digits and _. */
function keyOf(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'f_$1')
      .slice(0, 36) || 'field';
  let key = base;
  for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;
  return key;
}

/**
 * The choices of a select field from its text: saved choices keep their id when
 * their label is still listed and are archived otherwise (never removed); new
 * lines become new choices.
 */
function optionsOf(f: FieldDraft): TagFieldDef['options'] {
  const labels = [
    ...new Set(
      f.optionsText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];
  const taken = new Set(f.savedOptions.map((o) => o.id));
  const saved = f.savedOptions.map((o) => ({ ...o, archived: !labels.includes(o.label) }));
  const added = labels
    .filter((l) => !f.savedOptions.some((o) => o.label === l))
    .map((label) => {
      const id = keyOf(label, taken);
      taken.add(id);
      return { id, label, archived: false };
    });
  return [...saved, ...added];
}

interface FieldDraft {
  key: string;
  label: string;
  type: TagFieldDef['type'];
  required: boolean;
  /** One choice per line, as typed. */
  optionsText: string;
  /** Choices already saved on the tag (kept by label, archived when their line is gone). */
  savedOptions: TagFieldDef['options'];
  archived: boolean;
  /** Already saved on the tag: key and type are locked. */
  locked: boolean;
}

function FieldsEditor({
  fields,
  onChange,
}: {
  fields: FieldDraft[];
  onChange: (f: FieldDraft[]) => void;
}) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<FieldDraft>) =>
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`tf-${i}`}>{t('crm.tags.fieldLabel')}</Label>
              <Input
                id={`tf-${i}`}
                required
                maxLength={60}
                value={f.label}
                onChange={(e) => set(i, { label: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`tft-${i}`}>{t('crm.tags.fieldType')}</Label>
              <Select
                value={f.type}
                disabled={f.locked}
                onValueChange={(v) => set(i, { type: v as FieldDraft['type'] })}
              >
                <SelectTrigger id={`tft-${i}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((ft) => (
                    <SelectItem key={ft} value={ft}>
                      {t(`crm.tags.fieldTypes.${ft}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {f.locked ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set(i, { archived: !f.archived })}
              >
                {f.archived ? <ArchiveRestore /> : <Archive />}
                {t(f.archived ? 'crm.settings.restore' : 'crm.tags.archiveField')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('crm.filter.removeRule')}
                onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
              >
                <Trash2 />
              </Button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={f.required}
              onCheckedChange={(c) => set(i, { required: c === true })}
            />
            {t('crm.tags.required')}
          </label>
          {f.type === 'select' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`tfo-${i}`}>{t('crm.tags.options')}</Label>
              <Textarea
                id={`tfo-${i}`}
                rows={3}
                value={f.optionsText}
                onChange={(e) => set(i, { optionsText: e.target.value })}
              />
            </div>
          ) : null}
          {f.locked ? (
            <p className="text-xs text-muted-foreground">{t('crm.tags.keyLocked')}</p>
          ) : null}
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= 20}
          onClick={() =>
            onChange([
              ...fields,
              {
                key: '',
                label: '',
                type: 'text',
                required: false,
                optionsText: '',
                savedOptions: [],
                archived: false,
                locked: false,
              },
            ])
          }
        >
          <Plus />
          {t('crm.tags.addField')}
        </Button>
      </div>
    </div>
  );
}

export function TagDialog({ tag, onClose }: { tag: TagDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { create, update } = useTagDefinitionMutations();
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? '#f26b1d');
  const [type, setType] = useState<TagType>(tag?.type ?? 'classification');
  const [description, setDescription] = useState(tag?.description ?? '');
  const [fields, setFields] = useState<FieldDraft[]>(
    (tag?.fields ?? []).map((f) => ({
      ...f,
      optionsText: f.options
        .filter((o) => !o.archived)
        .map((o) => o.label)
        .join('\n'),
      savedOptions: f.options,
      locked: true,
    })),
  );
  const pending = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const taken = new Set(fields.filter((f) => f.locked).map((f) => f.key));
    const defs: TagFieldDef[] = fields.map((f) => {
      const key = f.locked ? f.key : keyOf(f.label, taken);
      taken.add(key);
      return {
        key,
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        options: f.type === 'select' ? optionsOf(f) : [],
        archived: f.archived,
      };
    });
    const fail = (err: unknown) => {
      toast.error(crmErrorMessage(t, err));
      // Someone else changed the tag: reopen to start from the latest version.
      if (err instanceof ApiClientError && err.code === 'CONFLICT' && tag) onClose();
    };
    if (tag) {
      update.mutate(
        {
          id: tag.id,
          body: { name, color, description, fields: defs, expectedVersion: tag.version },
        },
        {
          onSuccess: () => {
            toast.success(t('crm.tags.saved'));
            onClose();
          },
          onError: fail,
        },
      );
    } else {
      create.mutate(
        { name, color, type, description, fields: type === 'classification' ? [] : defs },
        {
          onSuccess: (x) => {
            toast.success(t('crm.tags.created', { name: x.name }));
            onClose();
          },
          onError: fail,
        },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(tag ? 'crm.tags.edit' : 'crm.tags.create')}</DialogTitle>
            <DialogDescription>{t(`crm.tags.typeHint.${type}`)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag-name">{t('crm.tags.name')}</Label>
              <Input
                id="tag-name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag-color">{t('crm.settings.color')}</Label>
              <input
                id="tag-color"
                type="color"
                className="h-9 w-14 cursor-pointer rounded-md border bg-transparent p-0.5"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-type">{t('crm.tags.type')}</Label>
            <Select
              value={type}
              disabled={Boolean(tag)}
              onValueChange={(v) => setType(v as TagType)}
            >
              <SelectTrigger id="tag-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t(`crm.tags.types.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-desc">{t('crm.tags.description')}</Label>
            <Textarea
              id="tag-desc"
              rows={2}
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {type !== 'classification' ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t('crm.tags.fields')}</legend>
              <FieldsEditor fields={fields} onChange={setFields} />
            </fieldset>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t('crm.detail.saveTag')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
