# Rapiz landing page: independent QA review

Reviewed 2026-10-24 by a separate QA agent. Result: **accepted for this local design iteration**. No material defects remain from this review. This is a technical and design review, not the owner's business approval or production launch authorization.

## Brief and skills

Read the user-requested Humanizer and Frontend Design skills, plus `docs/superpowers/specs/2026-10-24-harmonized-redesign.md`. Reviewed against the actual request: retain the supplied animated rabbit; return to a light, bounded, calm composition; explain the product in plain Vietnamese; preserve useful content and working browser interactions.

## Independently verified

- Inspected the rendered 1440px desktop hero and full page, and the 390px mobile full page using system Chrome via Playwright.
- The desktop hero scene is 1120px wide and begins 160px from the left at a 1440px viewport. Content is bounded; dark full-width scenes from the previous version are gone.
- The hero uses `/images/rapiz-rabbit.gif`, not the previous substitute SVG. Captured two animation frames each at 360px and 390px. The rabbit changes shape, remains visible, and no longer sits behind the message card.
- Browser checks at 360, 390, 768, 1024 and 1440px found no horizontal page overflow.
- Confirmed Be Vietnam Pro is the computed font and the core mobile conversation text is 12px after the readability fix.
- Clicked the industry tabs and verified that scenario content changes. The prior uppercase labels and vague English fragments have been rewritten in sentence case with specific descriptions.
- Inspected the modal's accessibility snapshot: it is named “Về bản demo Rapiz”; the close control is labeled. Escape closes it.
- Confirmed the reduced-motion setting loads the still frame in place of the GIF.
- No browser JavaScript errors were observed in independent browser checks.
- Copy now describes product information, out-of-hours replies, context, customer needs and staff handoff. Simulated dialogue and channel-availability limits are stated. No invented customers, conversion numbers or signup submission is presented.

## Issues found and resolved during review

1. Dynamic scenario data still restored the old uppercase marketing copy after a tab click. Rewritten.
2. The modal had no programmatic accessible name. `aria-labelledby` and a heading ID were added.
3. The mobile message card obscured the rabbit. The image was moved upward, then independently inspected in multiple animation frames at both 360px and 390px.
4. Core mobile chat text was 11px. Raised to 12px and checked in the browser.

## Limits

The design is accepted as a local marketing/demo iteration. The demo uses authored examples, not live AI or connected sales accounts. Browser checks do not certify platform integration readiness, legal copy, all assistive technologies, or all physical devices. Visual preference remains the owner's decision. The root agent runs the final build and complete project verification suite separately.

## Light/dark theme follow-up

Accepted by the independent QA reviewer after adding the theme switch. Verified system-dark initial rendering, live system preference changes, persistence after reload, explicit preference priority, keyboard Space activation, invalid stored-value fallback, readable dark mobile navigation, original orange GIF and light message card. No overflow at 360, 390, 700, 701, 768, 900, 1024 and 1440px; no browser errors or material defects.

Root verification also passed `npm run build`, `npm run test:e2e`, and `npm run test:theme`, including blocked local storage and cross-tab synchronization. Theme screenshots are saved in `research/preview/dark-desktop.png`, `dark-hero.png`, and `dark-mobile.png`.

## Curated rabbit assets review

Independent review of the Archive asset additions: **accepted for the local design iteration**. Read `research/assets/SELECTION.md` and checked the new image markup, styling and theme rules. Existing design acceptance remains subject to the limits above.

- Viewed the group-rabbit handoff panel, shy-rabbit FAQ and rocking-rabbit closing invitation on 1440px desktop and 390px mobile, in both light and dark themes. The assets sit in bounded illustrations and preserve text legibility. The original hero GIF remains present.
- Inspected multiple animation frames of the handoff and closing GIFs. Found a brief mobile overlap where a bouncing rabbit's ears passed behind the handoff label. The implementation reduced the mobile group image to 220px and desktop image to 240px.
- Rechecked the final sizes in Chrome at 360, 390 and 1440px. Read-only analysis of every source GIF frame found its topmost white artwork at y222/500. After the fix, artwork begins at y94.68px while the label ends at y86.28px on mobile; desktop artwork begins at y97.56px and the label ends at y93.28px. This leaves clearance through the animation.
- Independently decoded all three added images and confirmed successful loading, local sources, empty decorative alt text and `loading="lazy"`.
- With reduced motion enabled, both new GIF picture sources resolve to their still PNGs. The original hero retains its existing reduced-motion still behavior.
- No horizontal overflow or browser JavaScript errors appeared in the independent asset checks. No further material defects remain from this addition review.

Artwork ownership and licensing are not independently established; provenance remains user-supplied as documented in the selection notes. This review does not certify business claims or live integrations.

## Complete 13-asset Archive review

Independent review of the expanded artwork placement: **accepted for this local iteration**. This supersedes the earlier three-asset selection scope; the original orange hero remains, and all 13 Archive assets now appear directly on the page.

- Read the updated `research/assets/SELECTION.md` and inspected the image markup and final CSS/theme additions.
- In an independent Chrome session, counted 13 distinct Archive image elements, scrolled each into view and decoded each successfully. Confirmed that all six added animations resolve to PNG still sources under reduced motion.
- Captured and inspected full-page desktop/mobile compositions in both light and dark themes, plus individual intro, demo, capabilities and setup sections. The artwork stays inside the established content bounds. Text remains readable and the signed sketch is contained with its signature visible.
- Inspected three additional time-separated mobile animation samples in the capabilities section. Animated images play inside their illustration tiles without overlapping text. Artwork entering or leaving the animation frame remains part of the supplied sequence.
- Checked widths 360, 390, 700, 701, 768, 1024 and 1440px: no horizontal page overflow. No browser JavaScript errors occurred in these independent checks.
- Verified transcoded animation timing from the actual files: curious rabbit retains 2700ms (90 source GIF frames encoded as 65 WebP frames after duplicate-frame merging); bouncing rabbit retains 84 frames and 3360ms. The documentation accurately describes movement and timing preservation.
- The stale three-only selection document was flagged during review and replaced with the complete 13-file mapping and current optimization details.

No material defects remain from this addition review. This acceptance is for local rendering, loading and composition; it does not establish external artwork rights or approve a production release.

## Self-hosted typography and sticky header review

Independent QA result: **accepted for the local iteration** after the Vietnamese shaping fix. Review scope was typography, font delivery, role separation and sticky-header behavior. No artwork changes were made during this review.

### Typography and licensing

- Confirmed the canonical UI package defines Plus Jakarta Sans in `typography.css`; Fraunces faces are isolated in opt-in `brand-fonts.css`. Landing assets and CSS are synced from those canonical definitions.
- Independently verified SHA-256 hashes and byte sizes of all three full variable WOFF2 files against `SOURCES.json`, and byte-for-byte equality of the landing copies. Both font-family `LICENSE/OFL.txt` files are present and identical to their canonical copies. Provenance records upstream source URLs, source hashes and the TTF-to-WOFF2 format conversion.
- Initial review found two defects: Fraunces also applied to the UI dialog title, and the original split font subsets fell back for decomposed Vietnamese. The heading selector was scoped to `main h1, main h2`; the subset files were replaced with complete upstream variable fonts repackaged as WOFF2.
- Rechecked actual font use with Chrome DevTools `CSS.getPlatformFontsForNode`. A 104-character Vietnamese sample, including U+1EA0–U+1EF9 and Vietnamese base letters, renders entirely in Fraunces or Plus Jakarta Sans as intended. The fully NFD-normalized sample also renders entirely in each custom font, including Plus Jakarta Sans italic, with no fallback glyphs.
- Verified main landing h1/h2 use Fraunces; body, h3, buttons, tabs and dialog title use Plus Jakarta Sans. At the dashboard `/login` preview, body, h1, buttons, inputs and labels use Plus Jakarta Sans. Dashboard requests contain no Fraunces font and neither application makes Google Fonts CDN requests.
- Prior light/dark desktop/mobile visual checks confirmed heading bounds and all 13 artwork assets remain in the layout; seven viewport widths had no horizontal overflow. Font binaries and role changes do not replace or remove the artwork.

### Sticky header

- In an independent Chrome session, scrolled the page and verified the header stays at y=0 on desktop and mobile in both light and dark themes.
- Clicked the FAQ navigation link in all four combinations. The anchor target starts around y=116px on desktop and y=98px on mobile, below the 96px/78px headers, so its heading is not covered.
- Opened and used the mobile menu while scrolled; the menu remains readable, and selecting a link closes it. Inspected resulting light desktop and dark mobile screenshots.
- No horizontal overflow or browser JavaScript errors were observed in these focused checks.

Limits: dashboard browser verification used the unauthenticated login page, not authenticated business flows. Root runs the complete repository/build suites separately. This report does not assert production deployment or business approval.

Final root verification after the full-font replacement and sticky-header change passed: `pnpm check` in agent-sale; landing `npm run build`, `npm run test:e2e`, `npm run test:theme`, and `DASHBOARD_URL=http://localhost:5175 npm run test:fonts`. The font suite checks full NFC/NFD samples, normal/italic UI faces, local checksums/licenses, no Google font requests, and no dashboard Fraunces download. The interaction suite verifies header y=0 during scrolling and unobscured mobile anchor destinations. No artwork changes followed the user's stop instruction.

## Landing-wide Fraunces trial and compact header

Latest user-directed landing-only iteration: **accepted for local review**. This intentionally supersedes the prior landing role split; shared dashboard font tokens remain unchanged.

Independently checked computed styles for body, h1/h2/h3, wordmark, navigation, buttons, tabs, conversation bubbles, footer control, dialog heading and social glyph: each uses Fraunces. Verified the sticky header is 64px high on desktop and 60px on mobile, remains at y=0 while scrolled, and has no raised border/shadow. In both light and dark themes, FAQ anchor positions are approximately 84px/80px below the viewport top, clearing the compact header. Mobile menu opens and closes after navigation. Inspected light desktop and dark mobile screenshots; checked seven widths from 360px to 1440px with no horizontal overflow or browser JavaScript errors. No assets or monorepo source files were edited during this review.

## Larger Fraunces reading scale

Latest landing-only size adjustment: **accepted for local review**. Independently verified computed desktop sizes (18px body, 62px hero, 14px conversation) while the header remains 64px desktop/60px mobile. Inspected narrow mobile hero/capability content and intermediate-width navigation in both themes. Text wraps within its columns beside artwork; the handoff label retains its earlier framing. All 13 Archive images decoded successfully. Across 360, 390, 700, 701, 768, 1024 and 1440px, page/header/capability/tab/label bounds passed without horizontal overflow or browser JavaScript errors. No product source, artwork or monorepo files were edited during this review.
