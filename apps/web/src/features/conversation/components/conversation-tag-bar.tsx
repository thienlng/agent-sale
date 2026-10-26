import type { TagDto, TagValues } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TagValuesDialog } from '@/components/tag-values-dialog';
import { ApiClientError } from '@/lib/api-client';
import { useConversationTagActions, useConversationTags, useInboxTags } from '../api/inbox';
import type { InboxTagChip } from '../lib/inbox-v2-types';
import { TagBar, type LibraryTag } from './tag-bar';

type Props = {
  id: string;
  fallbackTags: InboxTagChip[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  readOnly: boolean;
};

/** A conversation change discards an unfinished tag form before another customer's thread renders. */
export function ConversationTagBar(props: Props) {
  return <ConversationTagBarContent key={props.id} {...props} />;
}

function ConversationTagBarContent({ id, fallbackTags, readOnly, ...bar }: Props) {
  const { t } = useTranslation();
  const library = useInboxTags();
  const tags = useConversationTags(id);
  const actions = useConversationTagActions(id);
  const [editing, setEditing] = useState<TagDto | null>(null);
  const [error, setError] = useState<string | undefined>();
  const busy = actions.attach.isPending || actions.remove.isPending;
  const fail = (cause: unknown) => {
    const key =
      cause instanceof ApiClientError && cause.code === 'FORBIDDEN'
        ? 'errors.forbidden'
        : cause instanceof ApiClientError && cause.code === 'CONFLICT'
          ? 'crm.stale'
          : 'channelInbox.v2.tagBar.error';
    const fields =
      cause instanceof ApiClientError && cause.code === 'VALIDATION_FAILED'
        ? cause.details?.['fields']
        : undefined;
    const labels =
      fields && typeof fields === 'object'
        ? Object.keys(fields).map(
            (key) => editing?.fields.find((field) => field.key === key)?.label ?? key,
          )
        : [];
    const message = labels.length
      ? t('crm.errors.fieldsInvalid', { fields: labels.join(', ') })
      : t(key);
    setError(message);
    toast.error(message);
  };
  const save = (tag: LibraryTag, values?: TagValues) => {
    if (readOnly || busy) return;
    setError(undefined);
    actions.attach.mutate(
      { ...tag, ...(values ? { values } : {}) },
      {
        onSuccess: () => {
          setEditing(null);
          bar.onPickerOpenChange(false);
        },
        onError: fail,
      },
    );
  };
  const attach = (tag: LibraryTag) => {
    if (readOnly || busy) return;
    const definition = library.data?.find((candidate) => candidate.id === tag.id);
    if (definition?.fields.some((field) => !field.archived)) {
      bar.onPickerOpenChange(false);
      setError(undefined);
      setEditing(definition);
    } else save(tag);
  };
  return (
    <>
      <TagBar
        {...bar}
        tags={tags.data ?? fallbackTags}
        library={library.data ?? []}
        readOnly={readOnly}
        busy={busy}
        onAttach={attach}
        onRemove={(tag) => {
          if (!readOnly && !busy) actions.remove.mutate(tag, { onError: fail });
        }}
      />
      {editing && !readOnly ? (
        <TagValuesDialog
          key={editing.id}
          tag={editing}
          initial={{}}
          pending={busy}
          error={error}
          onSave={(values) => save(editing, values)}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
