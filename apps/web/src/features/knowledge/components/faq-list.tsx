import type { FaqDto } from '@agent-sales/contracts';
import { foldVietnamese } from '@agent-sales/shared';
import { MessageCircleQuestion, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { placeholderLabel } from '@/lib/placeholders';

import { useDeleteFaq, useFaqs } from '../api/faqs';
import { FaqDialog } from './faq-dialog';

const PLACEHOLDER = /(\{\{\s*[a-z][a-z0-9_.]*\s*\}\})/g;

/** Shows `{{store.address}}` as a readable token ("Địa chỉ") instead of template syntax. */
function AnswerText({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <>
      {text.split(PLACEHOLDER).map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className="mx-0.5 rounded bg-primary-soft px-1 py-px text-sm font-medium text-accent-foreground"
          >
            {placeholderLabel(t, part.replace(/[{}\s]/g, ''))}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function FaqList({ botId }: { botId: string }) {
  const { t } = useTranslation();
  const faqs = useFaqs(botId);
  const remove = useDeleteFaq(botId);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [editing, setEditing] = useState<FaqDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<FaqDto | null>(null);

  // Same folding as the bot's search, so "phi ship" finds "Phí ship".
  const visible = useMemo(() => {
    const q = foldVietnamese(deferred.trim());
    const list = faqs.data ?? [];
    return q ? list.filter((f) => foldVietnamese(`${f.question} ${f.answer}`).includes(q)) : list;
  }, [faqs.data, deferred]);

  const open = (faq: FaqDto | null) => {
    setEditing(faq);
    setDialogOpen(true);
  };

  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('faq.title')}</h2>
          <p className="mt-1 text-muted-foreground">{t('faq.subtitle')}</p>
        </div>
        <Button size="lg" onClick={() => open(null)}>
          <Plus />
          {t('faq.add')}
        </Button>
      </header>

      {faqs.data?.length ? (
        <div className="mt-6 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('faq.search')}
              aria-label={t('faq.search')}
              className="h-10 pl-9"
            />
          </div>
          <span className="shrink-0 text-sm text-muted-foreground">
            {t('faq.count', { count: faqs.data.length })}
          </span>
        </div>
      ) : null}

      <div className="mt-4">
        {faqs.isPending ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : !faqs.data?.length ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
            <MessageCircleQuestion className="size-9 text-primary" aria-hidden />
            <h3 className="mt-3 text-lg font-semibold">{t('faq.emptyTitle')}</h3>
            <p className="mt-1 max-w-sm text-muted-foreground">{t('faq.emptyBody')}</p>
          </div>
        ) : !visible.length ? (
          <p className="py-10 text-center text-muted-foreground">
            {t('faq.noMatch', { query: deferred })}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {visible.map((faq) => (
              <li key={faq.id} className="group flex gap-3 px-5 py-4">
                <button
                  type="button"
                  onClick={() => open(faq)}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none"
                >
                  <span className="block font-medium group-hover:text-primary">{faq.question}</span>
                  <span className="mt-1 line-clamp-2 block text-muted-foreground">
                    <AnswerText text={faq.answer} />
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {faq.source === 'seed' ? (
                      <Badge variant="secondary">{t('faq.seed')}</Badge>
                    ) : null}
                    {faq.missingPlaceholders.length ? (
                      <Badge variant="secondary" className="bg-warning-soft text-warning">
                        {t('faq.missing', {
                          fields: faq.missingPlaceholders
                            .map((p) => placeholderLabel(t, p))
                            .join(', '),
                        })}
                      </Badge>
                    ) : null}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t('faq.edit')}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => open(faq)}>
                      <Pencil />
                      {t('faq.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(faq)}>
                      <Trash2 />
                      {t('faq.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FaqDialog botId={botId} open={dialogOpen} faq={editing} onOpenChange={setDialogOpen} />
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('faq.deleteConfirm', { question: deleting?.question ?? '' })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => toast.success(t('faq.deleted')),
                  onError: (err) => toast.error(errorMessage(t, err)),
                });
                setDeleting(null);
              }}
            >
              {t('faq.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
