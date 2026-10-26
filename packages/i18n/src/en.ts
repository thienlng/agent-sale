import action from './messages/en/action.json' with { type: 'json' };
import channelInbox from './messages/en/channel-inbox.json' with { type: 'json' };
import common from './messages/en/common.json' with { type: 'json' };
import training from './messages/en/training.json' with { type: 'json' };

/** English catalog: loaded on demand by the web app, so it stays out of the initial bundle. */
export const en = { common: { ...common, channelInbox }, training, action } as const;
