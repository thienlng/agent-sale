import { createFileRoute } from '@tanstack/react-router';

import { AssistantPage } from '@/features/assistant/components/assistant-page';
import { loadNamespace } from '@/lib/i18n';

/** The owner assistant on a page of its own (the side sheet's "expand"). */
export const Route = createFileRoute('/app/assistant')({
  loader: () => loadNamespace('assistant').then(() => undefined),
  component: AssistantPage,
});
