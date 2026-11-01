import type { PropertyDto } from '@agent-sales/contracts';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { useReplaceUnits } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { intOrNull, TabSaveBar, useReportDirty, useTabDraft } from './property-tab-parts';

interface RoomDraft {
  /** Absent for a room added in this draft. */
  id?: string;
  key: string;
  name: string;
  beds: string;
  adults: string;
  children: string;
  active: boolean;
}

const roomsOf = (p: PropertyDto): RoomDraft[] =>
  p.units
    .filter((u) => u.kind === 'room')
    .map((u) => ({
      id: u.id,
      key: u.id,
      name: u.name,
      beds: u.beds,
      adults: String(u.capacityAdults),
      children: String(u.capacityChildren),
      active: u.active,
    }));

/** Which fields of a room are wrong (shown under the field after a save attempt). */
const roomErrors = (r: RoomDraft) => {
  const adults = intOrNull(r.adults);
  const children = intOrNull(r.children || '0');
  return {
    name: !r.name.trim(),
    adults: adults === null || adults < 1,
    children: children === null || children < 0,
  };
};

const roomInvalid = (r: RoomDraft) => Object.values(roomErrors(r)).some(Boolean);

/**
 * "Phòng" tab (rooms places only): the room list as a table. Rooms switched off
 * (including the ones left off by an earlier whole → rooms switch) stay listed with a
 * clear "Đang tắt" badge and a switch to sell them again.
 */
export function RoomsTab({
  property: p,
  canEdit,
  onDirtyChange,
}: {
  property: PropertyDto;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const base = useMemo(() => roomsOf(p), [p]);
  const { draft: rooms, setDraft, dirty, discard } = useTabDraft(base);
  useReportDirty(dirty, onDirtyChange);
  const [submitted, setSubmitted] = useState(false);
  const replace = useReplaceUnits();
  const saveError = useSaveError();
  const invalid = rooms.length === 0 || rooms.some(roomInvalid);
  const inactive = rooms.filter((r) => !r.active).length;
  const setRoom = (key: string, patch: Partial<RoomDraft>) =>
    setDraft((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid || replace.isPending || !canEdit) return;
    replace.mutate(
      {
        id: p.id,
        body: {
          version: p.version,
          units: rooms.map((r) => ({
            ...(r.id ? { id: r.id } : {}),
            name: r.name.trim(),
            beds: r.beds.trim(),
            capacityAdults: intOrNull(r.adults) ?? 1,
            capacityChildren: intOrNull(r.children || '0') ?? 0,
            active: r.active,
          })),
        },
      },
      {
        onSuccess: (saved) => {
          setDraft(roomsOf(saved));
          setSubmitted(false);
          toast.success(t('lodging.editor.saved'), { duration: 3500 });
        },
        onError: (error) =>
          saveError(error, { onStale: discard, conflict: () => t('lodging.rooms.removeConflict') }),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('lodging.rooms.intro')}</p>
      {rooms.length > 0 && !rooms.some((r) => r.active) ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{t('lodging.rooms.noActive')}</AlertDescription>
        </Alert>
      ) : inactive > 0 ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertDescription>
            {t('lodging.rooms.inactiveHint', { count: inactive })}
          </AlertDescription>
        </Alert>
      ) : null}
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead>{t('lodging.rooms.name')}</TableHead>
            <TableHead>{t('lodging.rooms.beds')}</TableHead>
            <TableHead className="w-24">{t('lodging.rooms.adults')}</TableHead>
            <TableHead className="w-24">{t('lodging.rooms.children')}</TableHead>
            <TableHead className="w-36">{t('lodging.rooms.active')}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rooms.map((r) => {
            const bad = submitted ? roomErrors(r) : { name: false, adults: false, children: false };
            const errorId = (field: string) => `room-${r.key}-${field}-error`;
            return (
              <TableRow
                key={r.key}
                className={cn(!r.active && 'bg-muted/40 text-muted-foreground')}
              >
                <TableCell>
                  <Input
                    aria-label={t('lodging.rooms.name')}
                    value={r.name}
                    maxLength={100}
                    disabled={!canEdit}
                    aria-invalid={bad.name || undefined}
                    aria-describedby={bad.name ? errorId('name') : undefined}
                    onChange={(e) => setRoom(r.key, { name: e.target.value })}
                  />
                  {bad.name && (
                    <p id={errorId('name')} className="mt-1 text-xs text-destructive">
                      {t('lodging.rooms.nameRequired')}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={t('lodging.rooms.beds')}
                    value={r.beds}
                    maxLength={500}
                    disabled={!canEdit}
                    onChange={(e) => setRoom(r.key, { beds: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={t('lodging.rooms.adults')}
                    type="number"
                    min={1}
                    value={r.adults}
                    disabled={!canEdit}
                    aria-invalid={bad.adults || undefined}
                    aria-describedby={bad.adults ? errorId('adults') : undefined}
                    onChange={(e) => setRoom(r.key, { adults: e.target.value })}
                  />
                  {bad.adults && (
                    <p id={errorId('adults')} className="mt-1 text-xs text-destructive">
                      {t('lodging.rooms.adultsInvalid')}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={t('lodging.rooms.children')}
                    type="number"
                    min={0}
                    value={r.children}
                    disabled={!canEdit}
                    aria-invalid={bad.children || undefined}
                    aria-describedby={bad.children ? errorId('children') : undefined}
                    onChange={(e) => setRoom(r.key, { children: e.target.value })}
                  />
                  {bad.children && (
                    <p id={errorId('children')} className="mt-1 text-xs text-destructive">
                      {t('lodging.rooms.childrenInvalid')}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Switch
                      aria-label={t('lodging.rooms.activeLabel', { name: r.name })}
                      checked={r.active}
                      disabled={!canEdit}
                      onCheckedChange={(active) => setRoom(r.key, { active })}
                    />
                    {!r.active && <Badge variant="outline">{t('lodging.rooms.inactive')}</Badge>}
                  </span>
                </TableCell>
                <TableCell>
                  {canEdit && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('lodging.rooms.remove', { name: r.name })}
                      onClick={() => setDraft((rs) => rs.filter((x) => x.key !== r.key))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {canEdit && rooms.length < 100 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() =>
            setDraft((rs) => [
              ...rs,
              {
                key: crypto.randomUUID(),
                name: '',
                beds: '',
                adults: '2',
                children: '0',
                active: true,
              },
            ])
          }
        >
          <Plus aria-hidden />
          {t('lodging.rooms.add')}
        </Button>
      )}
      {submitted && rooms.length === 0 && (
        <p role="alert" className="text-sm text-destructive">
          {t('lodging.rooms.needOne')}
        </p>
      )}
      <TabSaveBar
        dirty={dirty}
        pending={replace.isPending}
        canEdit={canEdit}
        label={t('lodging.rooms.save')}
      />
    </form>
  );
}
