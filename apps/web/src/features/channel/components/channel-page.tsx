import { FanpagePanel } from './fanpage-panel';
import { IntegrationsView } from './integrations-view';

/** Workspace "Tích hợp nền tảng" (/app/channels): every page, any bot. */
export function ChannelPage() {
  return (
    <div className="space-y-6">
      <IntegrationsView mode={{ kind: 'workspace' }} />
      <FanpagePanel />
    </div>
  );
}
