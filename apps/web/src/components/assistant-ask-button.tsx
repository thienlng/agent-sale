import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { requestAssistant } from '@/lib/assistant-context';
import { useIsAccountOwner } from '@/lib/use-is-account-owner';

/**
 * "Nhờ trợ lý điền mẫu" (T175-R8): asks the owner assistant a fixed question on the owner's
 * behalf. The bubble opens and sends it (or leaves it in the composer while a turn runs). Only the
 * account owner may use the assistant, so everyone else sees nothing.
 */
export function AssistantAskButton({
  text,
  label,
  size = 'sm',
}: {
  /** The fixed message sent to the assistant; the page context says which page it is. */
  text: string;
  /** Button label; defaults to "Nhờ trợ lý điền mẫu". */
  label?: string;
  size?: 'sm' | 'default';
}) {
  const { t } = useTranslation();
  const isOwner = useIsAccountOwner();
  if (!isOwner) return null;
  return (
    <Button type="button" variant="outline" size={size} onClick={() => requestAssistant(text)}>
      <Sparkles aria-hidden />
      {label ?? t('app.assistantAskSample')}
    </Button>
  );
}
