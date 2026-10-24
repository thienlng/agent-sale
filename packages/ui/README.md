# @agent-sales/ui

Razpi design tokens (`tokens.css`): shadcn/ui variable names with the Razpi palette (white base, `#f26b1d` orange, ink text on orange for WCAG AA), extra tokens (`success`, `warning`, `primary-soft`, chat bubbles), the type scale and Be Vietnam Pro as the single family. Imported once by each app's CSS after Tailwind.

React components are shadcn/ui copied into each app by the shadcn CLI (`apps/web/src/components/ui`). Move a component here only when a second app (admin, widget) needs it.
