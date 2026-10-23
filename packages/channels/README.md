# @agent-sales/channels

`ChannelAdapter` contract (docs/07 §2) + `ChannelRegistry`. Each platform gets `src/<kind>/<kind>.adapter.ts` with recorded webhook fixtures in `src/<kind>/__fixtures__/` (record/replay — no real platform calls in tests).

Rules: platform SDK calls only inside the adapter; every error mapped to a `ConnectorError` with a `userAction`; `capabilities()` drives what the bot may send; reply-window rules enforced by the `channel` module using `replyWindowHours`.
