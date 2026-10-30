import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * The image library is no longer part of the bot menu (T-114). Old links and
 * bookmarks land on the bot home; the media API and existing images stay.
 */
export const Route = createFileRoute('/app/bots/$botId/media')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/app/bots/$botId', params, replace: true });
  },
});
