# Brand identity v2 "Precision" — implementation summary

Source of truth: the `rapiz-brand-identity` repository
(`Rapiz_Enterprise_Challenger_Brand_Identity_Design_System_v2.md`, `Rapiz_Spacing_Standard.md`,
`Rapiz_Layout_Effects_Standard.md`, logo masters in `releases/`). This page records how the
monorepo applies it, so code reviews do not need the brand repository open.

## Colour

| Role | Value | Token / usage |
|------|-------|---------------|
| Rapiz Orange | `#FF7A45` | `--primary`: primary action, selection, active indicator. Not a decoration fill. |
| Text on orange | Charcoal `#1F1F1F` | `--primary-foreground`. White on orange is 2.59:1 and fails WCAG AA. |
| Accessible orange | `#B54708` | `--brand-text`: orange text, links and focus rings on light surfaces. |
| Hover / pressed orange | `#E8622E` | `--primary-strong`. |
| Charcoal | `#1F1F1F` | Text, dashboard sidebar, site header/footer, PWA `theme_color`. |
| AI violet | `#8B6CFF` (brand), `#6941C6` (text) | `--ai-brand`, `--ai`: only for AI signals (bot replies, AI assistant). Never a second brand colour. |
| Neutrals | `#FFFFFF`, `#F4F4F4`, `#E4E4E4`, `#5C5C5C`… | Achromatic; no blue, green or beige cast. |

Semantic colours (`success`, `warning`, `destructive`) only mean states. Charts do not use orange
as an ordinary category colour.

Shop-configurable colours are not brand colours: the widget/website default `#F97316` and the CRM
tag defaults stay customer data and are unchanged by this rebrand.

## Type

- Inter (variable) for UI, body and headings (`--font-sans`, `--font-heading`).
- Inter Tight (`--font-display`) for display sizes; italic 900 only for brand moments (site hero
  figure "24/7", capability index numbers). Product text stays upright.
- No monospace accent typeface; `--font-mono` is the system stack, used only for codes and IDs.

## Shape, density, effects

- Radius roles: control 4px (`rounded-lg`, `--radius`), card 8px (`rounded-xl`), frame/dialog
  12px (`rounded-2xl` and up). Smaller utilities (`rounded-sm`, `rounded-md`) are 2–4px.
- Flat surfaces: borders instead of rings or shadows on cards; shadows only on floating layers
  (popovers, dialogs, the assistant launcher). No glass, blur or translucent sticky bars.
- Dashboard density is Compact: controls 44px (`h-11`); small controls (28/36px) keep a 44px hit
  area through an `after:` pseudo-element. Comfortable (48px) is for marketing and auth.
- Focus: form fields (input, textarea, select, input group, checkbox, radio, switch, widget
  composer) show no outer ring; their own 1px border turns Charcoal (`--foreground`), and an
  invalid field keeps a 1px destructive border. Buttons, links and other controls keep the
  keyboard-only 2px ring in `--ring` (`#B54708`) with a 3px offset.

## Surfaces

- Dashboard: charcoal sidebar with an orange inset indicator on the active item; white content;
  solid sticky header.
- Auth: charcoal aside with a cropped R mark at low opacity and a 1px orange rule.
- Marketing site: charcoal header, upright Inter hero, charcoal product-demo section, light feature
  sections, one orange closing band with a charcoal button, charcoal footer.
- Widget: white-label (shop colour `--c`) with the Precision neutrals, radius roles and focus.

## Logo

The primary logo is the **Primary / Faceted** master (`releases/logo-v2/svg/rapiz-logo-faceted.svg`):
the orange R with hard-edged facets (white at 12%, Charcoal at 20%) plus the RAPIZ wordmark. It is
used everywhere the product shows its logo:

- `apps/web/public/brand/` holds the release files unchanged (`rapiz-logo-faceted.svg`,
  `rapiz-symbol-faceted.svg`).
- `apps/web/src/components/logo.tsx` inlines the same master paths so the wordmark can follow
  `currentColor` (white on charcoal surfaces); the release has no faceted file with a white
  wordmark. The marketing site uses the brand repository's logo files as images
  (`apps/site/public/images/rapiz-logo.svg`, `rapiz-logo-reverse.svg`, `rapiz-symbol.svg`).
- App icons, favicons and the PWA icons are the faceted symbol group from the release placed on a
  charcoal square. Only the notification badge (`icons/badge-96.png`) stays a flat single-colour
  silhouette, because the platform uses its alpha channel alone.

The flat masters are not used in the product. A rabbit or mascot never stands in for the R mark.
