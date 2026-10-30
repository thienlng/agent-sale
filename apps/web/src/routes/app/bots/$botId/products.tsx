import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/app/bots/$botId/products')({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/app/bots/$botId/products"!</div>;
}
