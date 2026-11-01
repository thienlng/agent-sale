import type { BookingDetail } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

import type { BookingCreateInitial } from '../hooks/use-booking-draft';
import { BookingCreateForm } from './booking-create-form';
import type { NoteFocus } from './booking-night-notes';
import { BookingView, BookingViewTitle } from './booking-view';

export type { BookingCreateInitial };

/**
 * The booking sheet shared by the calendar, the bookings page and the inbox panel.
 * `create` starts a hold / confirmed booking / block (optionally prefilled); `view` shows
 * one booking with its status actions, editing and history.
 */
export type BookingSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & (
  | {
      mode: 'create';
      initial?: BookingCreateInitial;
      /** Called after a successful create (the sheet does not close itself). */
      onCreated?: (booking: BookingDetail) => void;
    }
  | {
      mode: 'view';
      bookingId: string;
      /** Open the "Ghi chú ngày" editor on this night and unit (the calendar's "Sửa ghi chú"). */
      noteAt?: NoteFocus;
    }
);

export function BookingSheet(props: BookingSheetProps) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side={mobile ? 'bottom' : 'right'}
        className="flex flex-col gap-0 data-[side=bottom]:max-h-[92svh] data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>
            {props.mode === 'create' ? (
              t('lodging.sheet.createTitle')
            ) : (
              <BookingViewTitle bookingId={props.bookingId} />
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {props.mode === 'create'
              ? t('lodging.sheet.createDescription')
              : t('lodging.sheet.viewDescription')}
          </SheetDescription>
        </SheetHeader>
        {props.open &&
          (props.mode === 'create' ? (
            <BookingCreateForm
              initial={props.initial}
              onCreated={(b) => (props.onCreated ? props.onCreated(b) : props.onOpenChange(false))}
              onClose={() => props.onOpenChange(false)}
            />
          ) : (
            <BookingView
              key={props.bookingId}
              bookingId={props.bookingId}
              focusNote={props.noteAt}
            />
          ))}
      </SheetContent>
    </Sheet>
  );
}
