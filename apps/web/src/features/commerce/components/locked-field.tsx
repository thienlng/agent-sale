import { ExternalLink, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';

/** Read-only look for fields a PMS owns: muted, not greyed out like a disabled field. */
export const LOCKED_FIELD = 'bg-muted/50 cursor-default';

/** "Sửa trên KiotViet": a link to the store's back office when the store is known. */
export function LockedHint({ id, retailer }: { id: string; retailer: string | null }) {
  const { t } = useTranslation();
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Lock className="size-4 shrink-0" aria-hidden />
      {retailer ? (
        <a
          href={`https://${retailer}.kiotviet.vn`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-text hover:underline md:min-h-0"
        >
          {t('products.lockedHint')}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : (
        t('products.lockedHint')
      )}
    </p>
  );
}

/** A field label with a lock icon when the field is read-only. */
export function FieldLabel({
  htmlFor,
  locked,
  children,
}: {
  htmlFor: string;
  locked: boolean;
  children: ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor}>
      {children}
      {locked ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : null}
    </Label>
  );
}
