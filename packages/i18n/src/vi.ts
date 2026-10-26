import action from './messages/vi/action.json' with { type: 'json' };
import channelInbox from './messages/vi/channel-inbox.json' with { type: 'json' };
import common from './messages/vi/common.json' with { type: 'json' };
import training from './messages/vi/training.json' with { type: 'json' };

/** Vietnamese catalog: the default locale, bundled with the app. */
export const vi = { common: { ...common, channelInbox }, training, action } as const;
