import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api-client';

/** 409 reasons of the skill routes that get their own sentence. */
const KNOWN_REASONS = new Set([
  'stale_skill',
  'skill_changed',
  'shadow_exists',
  'skill_limit',
  'skill_not_pending',
  'event_already_undone',
]);

/** A toast for a failed skill call: the conflict reason when known, else a generic line. */
export function useSkillErrorToast(): (error: Error) => void {
  const { t } = useTranslation('assistant');
  return (error) => {
    if (error instanceof ApiClientError) {
      const reason = error.details?.['reason'];
      // A taken name is a 409 with its own reason (AssistantSkillNameTakenError).
      if (error.status === 409 && typeof reason === 'string' && KNOWN_REASONS.has(reason)) {
        toast.error(t(`skills.errors.${reason}`));
        return;
      }
      if (reason === 'skill_name_taken') {
        toast.error(t('skills.errors.name_taken'));
        return;
      }
      if (error.status === 400) {
        toast.error(t('skills.errors.invalid'));
        return;
      }
    }
    toast.error(t('skills.errors.generic'));
  };
}
