import { useState } from 'react';
import { FanpageSettings, type FanpageActionKind } from '@agent-sales/contracts';
import { useFanpage } from '../api/fanpage';
export function useFanpageForm(id: string) {
  const data = useFanpage(id);
  const [draft, setDraft] = useState<FanpageSettings | null>(null);
  const [keywordText, setKeywordText] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const value = draft ?? data.settings.data ?? FanpageSettings.parse({});
  const patch = (change: Partial<FanpageSettings>) => setDraft({ ...value, ...change });
  const keywords = keywordText ?? value.hideKeywords.join('\n');
  const setKeywords = (text: string) => {
    setKeywordText(text);
    patch({
      hideKeywords: text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  };
  const save = () =>
    data.save.mutate(value, {
      onSuccess: () => {
        setDraft(null);
        setKeywordText(null);
      },
    });
  const togglePost = (postId: string, enabled: boolean) =>
    patch({
      excludedPostIds: enabled
        ? value.excludedPostIds.filter((id) => id !== postId)
        : [...value.excludedPostIds, postId],
    });
  const send = (commentId: string, kind: FanpageActionKind) =>
    data.act.mutate(
      { commentId, kind, text: kind.endsWith('reply') ? text : '', requestId: crypto.randomUUID() },
      {
        onSuccess: () => {
          setTarget(null);
          setText('');
        },
      },
    );
  return {
    ...data,
    value,
    keywords,
    setKeywords,
    patch,
    saveForm: save,
    togglePost,
    text,
    setText,
    target,
    setTarget,
    send,
  };
}
