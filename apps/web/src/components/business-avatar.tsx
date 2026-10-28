import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';

import { apiBlob } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

/**
 * A business's logo (the picture set in Settings › Shop profile), or a building icon
 * without one. The picture is read with that business's own scope, so it also works for
 * businesses other than the selected one; `logoVersion` refreshes the cached image.
 */
export function BusinessAvatar({
  workspaceId,
  logoVersion,
  className,
}: {
  workspaceId: string;
  logoVersion: string | null | undefined;
  className?: string;
}) {
  const version = logoVersion ?? null;
  const logo = useQuery({
    queryKey: queryKeys.logo(workspaceId, version),
    queryFn: async () => {
      const blob = await apiBlob('/workspace/logo', workspaceId);
      return blob ? URL.createObjectURL(blob) : null;
    },
    enabled: version !== null,
    staleTime: Infinity,
    gcTime: 60_000,
  });
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground',
        className,
      )}
    >
      {logo.data ? (
        <img src={logo.data} alt="" className="size-full object-cover" />
      ) : (
        <Building2 className="size-4" />
      )}
    </span>
  );
}
