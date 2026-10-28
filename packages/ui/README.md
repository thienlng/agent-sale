# @agent-sales/ui

Rapiz design tokens (`tokens.css`): shadcn/ui variable names with the Rapiz palette (white base, `#f26b1d` orange, ink text on orange for WCAG AA), extra tokens (`success`, `warning`, `primary-soft`, chat bubbles), the type scale, and the font stacks: Space Grotesk (`--font-sans`, `--font-heading`) and JetBrains Mono (`--font-mono`, small labels and codes), T-123. Each app loads the font files itself. Imported once by each app's CSS after Tailwind.

React components are shadcn/ui copied into each app by the shadcn CLI (`apps/web/src/components/ui`). Move a component here only when a second app (admin, widget) needs it.
