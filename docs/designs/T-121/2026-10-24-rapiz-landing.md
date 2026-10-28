# Rapiz Landing Page Implementation Plan

**Goal:** Build a polished Vietnamese Rapiz marketing page with the supplied rabbit identity.
**Architecture:** Astro static output, CSS design system, browser-only illustrative demo. No backend dependency.
**Tech Stack:** Astro, CSS, JavaScript, Playwright verification.
**Spec:** docs/superpowers/specs/2026-10-24-rapiz-design.md

## Global Constraints

Use supplied assets locally. Preserve the product source. Do not invent availability, pricing, testimonials, or actual lead submission. User delegated execution; implement directly in this session.

## Review Focus

Mobile overflow; keyboard navigation; reduced motion; industry-switch state; honest demo/contact behavior.

## Tasks

- [x] Create `src/pages/index.astro` for complete content and interactions, `src/styles/global.css` for responsive styles, and local assets in `public/images`.
- [x] Install dependencies and run `npm run build` to verify the static output.
- [x] Create `scripts/verify.mjs` to check desktop/mobile overflow, demo switching, modal behavior, FAQ, and browser errors. Capture both viewport screenshots.
- [x] Inspect screenshots, fix observed issues, rerun affected checks, document local run instructions.

## Harmonized revision

- [x] Read the user-supplied Humanizer and Frontend Design skills in full; write a restrained token/layout brief and critique previous defaults.
- [x] Restore the supplied GIF, rewrite Vietnamese copy, and replace the competing stylesheets with a single bounded design.
- [x] Verify actual GIF loading, reduced-motion still frame, bounded desktop hero, demo/tab keyboard navigation, modal name/behavior, FAQ, mobile menu, and overflow at five widths.
- [x] Build static output and inspect desktop/mobile screenshots.
- [x] Request independent QA and fix reported copy, accessible dialog name, mobile mascot overlap, and mobile dialogue size. Final QA acceptance is recorded separately in research/QA-REVIEW.md.
