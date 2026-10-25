import {
  FanpageSettings,
  FanpagePost,
  FanpageComment,
  FanpageAction,
  type FanpageManualAction,
} from '@agent-sales/contracts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';
export function useFanpage(id: string) {
  const ws = useWorkspaceId(),
    qc = useQueryClient(),
    path = `/channels/${id}/fanpage`;
  const key = ['fanpage', ws, id];
  const settings = useQuery({
    queryKey: [...key, 'settings'],
    queryFn: () => api(`${path}/settings`, FanpageSettings),
    enabled: Boolean(ws && id),
  });
  const posts = useQuery({
    queryKey: [...key, 'posts'],
    queryFn: () => api(`${path}/posts`, z.object({ data: z.array(FanpagePost) })),
    enabled: Boolean(ws && id),
    retry: false,
  });
  const comments = useQuery({
    queryKey: [...key, 'comments'],
    queryFn: () => api(`${path}/comments`, z.object({ data: z.array(FanpageComment) })),
    enabled: Boolean(ws && id),
    refetchInterval: 10000,
  });
  const save = useMutation({
    mutationFn: (body: FanpageSettings) =>
      api(`${path}/settings`, FanpageSettings, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const act = useMutation({
    mutationFn: ({ commentId, ...body }: FanpageManualAction & { commentId: string }) =>
      api(
        `${path}/comments/${encodeURIComponent(commentId)}/actions`,
        z.object({ action: FanpageAction.nullable() }),
        { method: 'POST', body },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  return {
    settings,
    posts,
    comments,
    save,
    act,
    refresh: () => qc.invalidateQueries({ queryKey: key }),
  };
}
