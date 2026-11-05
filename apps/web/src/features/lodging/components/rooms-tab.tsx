import {
  galleryCoverUrl,
  type PropertyDto,
  type UnitDto,
  type UnitInput,
} from '@agent-sales/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { ImageOff, MoreVertical, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { useReplaceUnits } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { formatVnd } from '../lib/format';
import { lowestWeekdaySell, MAX_UNITS, roomUnits, unitInputOf } from '../lib/units-model';
import { AddUnitDialog } from './add-unit-dialog';
import { CoverImage } from './cover-image';

/**
 * "Đơn vị cho thuê" tab (rooms places only): one card per unit (room, bungalow, house) with
 * its cover, type, view, party and lowest weekday price; a card opens the unit page. Turning a
 * unit on or off, moving, deleting and adding save the whole unit list at once (`PUT units`,
 * every unit sent back with all of its fields). Units switched off stay listed, marked "Đang tắt".
 */
export function RoomsTab({ property: p, canEdit }: { property: PropertyDto; canEdit: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const units = roomUnits(p);
  const replace = useReplaceUnits();
  const saveError = useSaveError();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<UnitDto | null>(null);
  const inactive = units.filter((u) => !u.active).length;

  const save = (next: UnitInput[], onSaved?: (saved: PropertyDto) => void) => {
    if (replace.isPending || !canEdit) return;
    replace.mutate(
      { id: p.id, body: { version: p.version, units: next } },
      {
        onSuccess: (saved) => {
          toast.success(t('lodging.editor.saved'), { duration: 3500 });
          onSaved?.(saved);
        },
        onError: (error) => saveError(error, { conflict: () => t('lodging.units.removeConflict') }),
      },
    );
  };
  const inputs = () => units.map(unitInputOf);
  const move = (index: number, delta: -1 | 1) => {
    const next = inputs();
    const [u] = next.splice(index, 1);
    if (u) next.splice(index + delta, 0, u);
    save(next);
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('lodging.units.intro')}</p>
      {units.length > 0 && inactive === units.length ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{t('lodging.units.noActive')}</AlertDescription>
        </Alert>
      ) : inactive > 0 ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertDescription>
            {t('lodging.units.inactiveHint', { count: inactive })}
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {units.map((u, i) => (
          <li key={u.id} className="min-w-0">
            <UnitCard
              property={p}
              unit={u}
              canEdit={canEdit}
              busy={replace.isPending}
              first={i === 0}
              last={i === units.length - 1}
              onActive={(active) =>
                save(
                  units.map((x) => ({ ...unitInputOf(x), ...(x.id === u.id ? { active } : {}) })),
                )
              }
              onMove={(delta) => move(i, delta)}
              onRemove={() => setRemoving(u)}
            />
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={units.length >= MAX_UNITS}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden />
            {t('lodging.units.add')}
          </Button>
          {units.length >= MAX_UNITS && (
            <span className="text-xs text-muted-foreground">
              {t('lodging.units.limit', { count: MAX_UNITS })}
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('lodging.editor.readOnly')}</p>
      )}
      {adding && (
        <AddUnitDialog
          pending={replace.isPending}
          onClose={() => setAdding(false)}
          onAdd={(unit) =>
            save([...inputs(), unit], (saved) => {
              setAdding(false);
              const created = roomUnits(saved).at(-1);
              if (created)
                void navigate({
                  to: '/app/properties/$propertyId/units/$unitId',
                  params: { propertyId: p.id, unitId: created.id },
                });
            })
          }
        />
      )}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('lodging.units.removeTitle', { name: removing?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('lodging.units.removeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lodging.units.keep')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const id = removing?.id;
                setRemoving(null);
                if (id) save(inputs().filter((u) => u.id !== id));
              }}
            >
              {t('lodging.units.removeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** "Tiêu chuẩn 2 · Tối đa 4" of a unit (the max only when it has one). */
export function partyLine(t: TFunction, u: UnitDto): string {
  const standard = t('lodging.units.standard', { count: u.capacityAdults + u.capacityChildren });
  return u.maxGuests === null
    ? standard
    : `${standard} · ${t('lodging.units.max', { count: u.maxGuests })}`;
}

function UnitCard({
  property: p,
  unit: u,
  canEdit,
  busy,
  first,
  last,
  onActive,
  onMove,
  onRemove,
}: {
  property: PropertyDto;
  unit: UnitDto;
  canEdit: boolean;
  busy: boolean;
  first: boolean;
  last: boolean;
  onActive: (active: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const cover = galleryCoverUrl(u);
  const from = lowestWeekdaySell(p, u.id);
  const titleId = `unit-${u.id}-title`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/40 focus-within:ring-2 focus-within:ring-ring',
        !u.active && 'bg-muted/40',
      )}
    >
      {/* Fixed 4:3 crop, as the property cards. */}
      <div
        className={cn(
          'relative aspect-[4/3] shrink-0 overflow-hidden bg-muted',
          !u.active && 'opacity-60',
        )}
      >
        {cover ? (
          <CoverImage src={cover} alt={u.name} />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ImageOff className="size-4" aria-hidden />
              {t('lodging.units.noPhoto')}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <h3 id={titleId} className="min-w-0 text-sm font-semibold break-words">
            <Link
              to="/app/properties/$propertyId/units/$unitId"
              params={{ propertyId: p.id, unitId: u.id }}
              className="outline-none after:absolute after:inset-0"
            >
              {u.name}
            </Link>
          </h3>
          <span className="flex shrink-0 gap-1">
            {!u.active && <Badge variant="outline">{t('lodging.units.inactive')}</Badge>}
            <Badge variant="secondary">{t(`lodging.units.category.${u.category}`)}</Badge>
          </span>
        </div>
        {u.view && <p className="text-xs text-muted-foreground">{u.view}</p>}
        <p className="text-xs tabular-nums text-muted-foreground">{partyLine(t, u)}</p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-sm font-medium tabular-nums">
            {from === null
              ? t('lodging.units.noPrice')
              : t('lodging.units.from', { amount: formatVnd(from) })}
          </span>
          {canEdit && (
            // Above the card link, so the switch and the menu do not open the unit page.
            <span className="relative z-10 flex items-center gap-1">
              <Switch
                aria-label={t('lodging.units.activeLabel', { name: u.name })}
                checked={u.active}
                disabled={busy}
                onCheckedChange={onActive}
              />
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={t('lodging.units.menu', { name: u.name })}
                  >
                    <MoreVertical aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
                    {t('lodging.units.moveUp')}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
                    {t('lodging.units.moveDown')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={first && last}
                    onSelect={onRemove}
                  >
                    {t('lodging.units.remove')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
