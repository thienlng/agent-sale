import { IntegrationsView } from './integrations-view';

/** Workspace "Tích hợp nền tảng" (/app/channels): every page, any bot. */
export function ChannelPage() {
  return <IntegrationsView mode={{ kind: 'workspace' }} />;
}
