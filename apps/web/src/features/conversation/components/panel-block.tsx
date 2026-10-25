import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/** A collapsible block of the right panel; the summary shows on the header while collapsed. */
export function PanelBlock({
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  title: string;
  summary?: string | undefined;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section aria-label={title} className="border-b">
        <CollapsibleTrigger
          aria-label={t('channelInbox.v2.panel.toggle', { title })}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold hover:bg-muted/40"
        >
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              !open && '-rotate-90',
            )}
            aria-hidden
          />
          <span>{title}</span>
          {!open && summary ? (
            <span className="min-w-0 flex-1 truncate text-right text-xs font-normal text-muted-foreground">
              {summary}
            </span>
          ) : null}
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}
