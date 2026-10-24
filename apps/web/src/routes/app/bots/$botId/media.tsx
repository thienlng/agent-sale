import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { MediaLibrary } from '@/features/knowledge/components/media-library';

/** The open folder lives in the URL so back/forward and reloads keep it. */
const Search = z.object({
  folder: z.string().max(64).optional().catch(undefined),
});

export const Route = createFileRoute('/app/bots/$botId/media')({
  validateSearch: Search,
  component: function MediaPage() {
    const { botId } = Route.useParams();
    const { folder } = Route.useSearch();
    const navigate = useNavigate({ from: '/app/bots/$botId/media' });
    return (
      <MediaLibrary
        botId={botId}
        folderId={folder}
        onFolderChange={(next) => void navigate({ search: next ? { folder: next } : {} })}
      />
    );
  },
});
