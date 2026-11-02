# features/knowledge

Mirrors the backend `knowledge` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

## Owner assistant forms (T-175)

Components register forms with `useAssistantForm` (`@/lib/assistant-context`); a fill sets draft state and never saves. Editing an existing row never registers.

| Form id | Registered by | Fill |
|---|---|---|
| `bot-profile` | `business-profile-form.tsx` (`enabled: canEdit`, submit target `bot-profile.save`) | Profile fields of the industry except `mapsUrl`, plus `notes`; clamped to each field's `max`. |
| `faq` | `faq-list.tsx` (closed, `opensDialog`) and `faq-dialog.tsx` (open, new FAQ) | The list opens `FaqDialog` with `prefill`; the dialog sets question/answer. |
| `bot-personality` | `personality-card.tsx` (`enabled: canEdit`, submit target `bot-personality.save`) | Mission, greeting, pronouns, `replyLength`, `tone`, `allowEmoji` (`yes`/`no`). |
| `scenario` | `rules-list.tsx` (closed, `opensDialog`) and `TrainingItemEditor` in `training-items.tsx` (open, new scenario) | The list opens the editor with `prefill`; field helpers `scenarioFormFields`, `scenarioPrefill`. |
| `quick-reply` | `quick-reply-list.tsx` (closed, `opensDialog`) and `quick-reply-dialog.tsx` (open, new) | The list opens the dialog with `prefill`; `quickReplyFormFields`, `quickReplyPrefill` (shortcut normalised); never `mediaUrl`. |

`prefill` props: `FaqDialog`, `TrainingItemEditor` and `QuickReplyDialog` take an optional `prefill` used only for a new item. `useBotPageContext(botId, title)` (in `training-items.tsx`) describes the page to the assistant (`title`, `entity { botId, industry }`). The empty FAQ, scenario and quick-reply lists and the profile card (required basic field empty) show `AssistantAskButton` (`@/components/assistant-ask-button`), owner-only, with fixed sentences from the `training` namespace.
