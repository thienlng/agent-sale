import { MAX_PRODUCT_IMAGES, ProductImageUrl } from '@agent-sales/contracts';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Why `raw` cannot join `current`, or null when it can. */
export function imageUrlProblem(
  raw: string,
  current: readonly string[],
): 'invalid' | 'duplicate' | 'limit' | null {
  if (current.length >= MAX_PRODUCT_IMAGES) return 'limit';
  const parsed = ProductImageUrl.safeParse(raw);
  if (!parsed.success) return 'invalid';
  return current.includes(parsed.data) ? 'duplicate' : null;
}

/** Up to five HTTPS pictures of a product, with thumbnails; the bot sends them on request. */
export function ProductImagesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<'invalid' | 'duplicate' | 'limit' | null>(null);
  const full = value.length >= MAX_PRODUCT_IMAGES;

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const issue = imageUrlProblem(trimmed, value);
    setProblem(issue);
    if (issue) return;
    onChange([...value, trimmed]);
    setDraft('');
  }

  const errorKey = problem
    ? (
        {
          invalid: 'products.form.imageInvalid',
          duplicate: 'products.form.imageDuplicate',
          limit: 'products.form.imageLimit',
        } as const
      )[problem]
    : null;

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
                onClick={() => {
                  setProblem(null);
                  onChange(value.filter((_, idx) => idx !== i));
                }}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-col gap-1.5">
        <Label htmlFor="pf-image-url">{t('products.form.imageUrl')}</Label>
        <div className="flex gap-2">
          <Input
            id="pf-image-url"
            type="url"
            inputMode="url"
            maxLength={2000}
            disabled={full}
            value={draft}
            aria-invalid={problem ? true : undefined}
            aria-describedby={errorKey ? 'pf-image-error' : undefined}
            placeholder="https://"
            onChange={(e) => {
              setDraft(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              // Enter adds the picture instead of submitting the whole product form.
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" disabled={full || !draft.trim()} onClick={add}>
            <Plus />
            {t('products.form.addImage')}
          </Button>
        </div>
        {errorKey ? (
          <p id="pf-image-error" role="alert" className="text-sm text-destructive">
            {t(errorKey, { max: MAX_PRODUCT_IMAGES })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
