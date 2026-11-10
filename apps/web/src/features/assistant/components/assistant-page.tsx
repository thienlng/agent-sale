import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandMark } from '@/components/logo';
import { useIsAccountOwner } from '@/lib/use-is-account-owner';

import { useAssistantUi } from '../stores/assistant-ui.store';

/**
 * The full-page assistant (`/app/assistant`): a viewport-high slot the panel renders the
 * conversation into (see `AssistantPanel`), so the sheet and the page share one conversation.
 * Owners of the account only, like the launcher; anyone else sees why it is empty.
 */
export function AssistantPage() {
  const { t } = useTranslation();
  const isOwner = useIsAccountOwner();
  const setPageSlot = useAssistantUi((s) => s.setPageSlot);
  // A callback ref: registered when the slot mounts, cleared when the owner leaves the page.
  const slot = useCallback((el: HTMLDivElement | null) => setPageSlot(el), [setPageSlot]);
  if (!isOwner) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-sidebar">
          <BrandMark className="h-6" />
        </span>
        <p className="mt-4 max-w-sm text-sm text-muted-foreground">
          {t('app.assistantOwnersOnly')}
        </p>
      </div>
    );
  }
  return (
    <div
      ref={slot}
      data-content-padding="false"
      data-testid="assistant-page"
      // Fixed to the viewport minus the top bar, like the inbox: the conversation scrolls inside.
      className="flex h-[calc(100svh-var(--header-height))] w-full min-w-0 overflow-hidden bg-background"
    />
  );
}
