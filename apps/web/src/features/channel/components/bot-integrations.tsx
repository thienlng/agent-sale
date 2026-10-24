import { IntegrationsView } from './integrations-view';

/** A bot's "Tích hợp" tab: only the pages this bot answers; new pages are bound to it. */
export function BotIntegrations({ botId }: { botId: string }) {
  return <IntegrationsView key={botId} mode={{ kind: 'bot', botId }} />;
}
