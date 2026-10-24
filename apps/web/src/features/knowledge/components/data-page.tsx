import { ChevronDown, ChevronLeft, ChevronRight, PackageOpen, Plus, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { PAGE_SIZES } from '../utils/table-data';

/** Title + subtitle of a training data page, with optional right-side content. */
export function DataPageHeader({
  title,
  subtitle,
  aside,
  className,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {aside}
    </header>
  );
}

/** Search box with a leading magnifier icon; the placeholder doubles as accessible label. */
export function DataSearch({
  value,
  onChange,
  placeholder,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn('relative w-full sm:w-80', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 pl-9"
      />
    </div>
  );
}

/** Primary "Thêm …" button opening a menu (add manually / import from file). */
export function AddMenuButton({
  label,
  onManual,
  onImport,
}: {
  label: string;
  onManual: () => void;
  onImport?: () => void;
}) {
  const { t } = useTranslation('training');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-9">
          <Plus />
          {label}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onManual}>{t('data.addManual')}</DropdownMenuItem>
        {onImport ? (
          <DropdownMenuItem onSelect={onImport}>{t('data.importFile')}</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Box illustration + message, used inside tables and grids. */
export function DataEmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-primary-soft">
        <PackageOpen className="size-8 text-primary" aria-hidden />
      </span>
      <p className="max-w-sm text-sm text-foreground">{message}</p>
      {children}
    </div>
  );
}

/** Error box with a retry button. */
export function DataError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('training');
  return (
    <div role="alert" className="rounded-xl border p-6">
      <p>{t('data.error')}</p>
      <Button className="mt-3" variant="outline" onClick={onRetry}>
        {t('data.retry')}
      </Button>
    </div>
  );
}

/** "Tổng N …" on the left; page size select, current page and arrows on the right. */
export function DataPagination({
  total,
  page,
  pages,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: ReactNode;
  page: number;
  pages: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const { t } = useTranslation('training');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-sm text-muted-foreground">{total}</p>
      <Select value={String(pageSize)} onValueChange={(value) => onPageSize(Number(value))}>
        <SelectTrigger aria-label={t('data.pageSize')} className="h-9 w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('data.previous')}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft />
      </Button>
      <span
        className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground tabular-nums"
        aria-label={t('data.currentPage', { page, pages })}
      >
        {page}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('data.next')}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

/** Shared look of the data tables: bordered, muted header, horizontal scroll on phones. */
export const tableFrame = 'overflow-hidden rounded-xl border';
export const tableHeadRow = 'bg-muted hover:bg-muted [&>th]:font-medium [&>th]:text-primary';
