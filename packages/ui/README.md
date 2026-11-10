# @agent-sales/ui

Rapiz design tokens (`tokens.css`), brand identity v2 "Precision" (`docs/designs/brand-identity-v2.md`): shadcn/ui variable names with the Rapiz palette (achromatic neutrals, orange `#ff7a45` with charcoal text on orange, `brand-text` `#b54708` for orange text and focus, violet `ai` tokens reserved for AI signals, a sidebar that follows the light/dark theme), extra tokens (`success`, `warning`, `primary-soft`, `primary-strong`, `scrim`, chat bubbles), the radius roles (control 4px, card 8px, frame 12px), the type scale and the font stacks: Inter (`--font-sans`, `--font-heading`) and Inter Tight (`--font-display`). Each app loads the font files itself. Imported once by each app's CSS after Tailwind.

React components are shadcn/ui copied into each app by the shadcn CLI (`apps/web/src/components/ui`). Move a component here only when a second app (admin, widget) needs it.
