import { MAX_PRODUCT_IMAGES } from '@agent-sales/contracts';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { ImageUploadZone } from './image-upload-zone';

/** Move the item at `from` by `delta` places, or return the list unchanged at the edges. */
export function moveItem<T>(list: readonly T[], from: number, delta: -1 | 1): T[] {
  const to = from + delta;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[from], next[to]] = [next[to] as T, next[from] as T];
  return next;
}

/** Up to five product pictures uploaded from the device; the bot sends them on request. */
export function ProductImagesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
}) {
  const { t } = useTranslation();
  // Uploads finish later: append to what the user has now, not to what they had at the start.
  const latest = useRef(value);
  latest.current = value;

  return (
    <section className="rounded-xl border bg-card p-4 md:p-5" aria-labelledby="pf-images-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pf-images-title" className="font-semibold">
          {t('products.form.images')}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t('products.form.imageCount', { n: value.length, max: MAX_PRODUCT_IMAGES })}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('products.form.imagesHint', { max: MAX_PRODUCT_IMAGES })}
      </p>

      {value.length ? (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {value.map((url, i) => (
            <li key={url} className="relative overflow-hidden rounded-lg border bg-muted">
              <img
                src={url}
                alt={t('products.form.imageAlt', { n: i + 1 })}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="aspect-square w-full object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-1 top-1 size-7"
                aria-label={t('products.form.removeImage', { n: i + 1 })}
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <X aria-hidden />
              </Button>
              <div className="absolute inset-x-1 bottom-1 flex justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="size-7"
                  disabled={i === 0}
                  aria-label={t('products.form.moveImageLeft', { n: i + 1 })}
                  onClick={() => onChange(moveItem(value, i, -1))}
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="size-7"
                  disabled={i === value.length - 1}
                  aria-label={t('products.form.moveImageRight', { n: i + 1 })}
                  onClick={() => onChange(moveItem(value, i, 1))}
                >
                  <ChevronRight aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <ImageUploadZone
        remaining={MAX_PRODUCT_IMAGES - value.length}
        onUploaded={(urls) => onChange([...latest.current, ...urls].slice(0, MAX_PRODUCT_IMAGES))}
      />
    </section>
  );
}
