# Rapiz landing page research — 2026-10-24

## Context

The landing page checkout is `/home/kenknight/Workspace/ai-sale-landingpage`, initially empty apart from Git. The product repository is a read-only reference for this task. Its README, product overview, and channel integration design describe omnichannel consultation, human handoff, CRM, orders, and re-engagement. Roadmap documents are not proof that every integration is production ready. Confirm connector availability before making availability claims.

## Reference observations

- https://preny.ai — Browser screenshot captured. White page, purple/pink gradient headline, floating product panels, prominent signup CTAs. Useful product breadth; Rapiz should use a calmer composition and a single demonstration at a time.
- https://tnova.vn — Browser screenshot captured. Currently hospitality-focused: Zalo messages, room availability, deposits. Split hero, blue palette, concrete workflow messaging. Useful lesson: explain a specific customer situation.
- https://diro.ai — Browser screenshot captured. Dark blue hero, robot mascot, feature and pricing content. Rapiz should express its rabbit identity rather than borrowing the robot or performance claims.
- https://muse.ai — Browser redirected to a Meta-branded Muse login page. Screenshot captures that destination, not a complete marketing site. Dark neutral canvas, centered large type, tiny character embedded in heading.
- https://x.ai/bot — Text accessible through web fetch: teammate positioning, workflow demos, role exploration, FAQ. Local browser blocked by Cloudflare; screenshot is the blocking page, not design evidence.
- https://chatgpt.com/features/bots/ — Web fetch returned no readable body. Local screenshot shows loading screen only. No detailed visual conclusions drawn.

Screenshots are in `references/`; access failures are retained to document the actual observation.

## Supplied brand assets

- `/home/kenknight/Downloads/ logo_rapizrapiz.jpeg`: orange rabbit silhouette with orbital ring on white. Preserve its proportions and identity.
- `/home/kenknight/Downloads/0403547ab9547f0eab4796c43eaf2a51.gif`: supplied white rounded rabbit on coral background. Potential motion reference or supporting illustration, subject to final art direction.

## Proposed direction, awaiting user selection

A. Warm off-white, black editorial typography, brand orange, tactile rabbit mascot. Recommended balance of friendliness and business credibility.
B. Dark neutral canvas, orange rabbit, cinematic light. More dramatic technology positioning.
C. Very restrained neutral canvas, interactive conversation demonstration first, minimal mascot presence.

Suggested narrative: Meet Rapiz → see a representative consultation → understand channels → explore industry scenarios → see knowledge and human handoff → setup steps → FAQ → request a demo.

Draft hero: “Khách hàng không chờ. Rapiz luôn ở đây.” Supporting copy explains 24/7 consultation using business knowledge and a shared team workflow. Demo interactions must be labeled illustrative. Do not invent customer logos, conversion metrics, testimonials, pricing, free trials, or live backend behavior.

Technical recommendation: Astro static marketing site, aligned with the product repository's chosen marketing stack; responsive Vietnamese content, keyboard-accessible interactions, reduced-motion support, optimized local assets. Keep all implementation in the landing page checkout.

## Workflow status

Superpowers using-superpowers and brainstorming were read. Three visual approaches were presented via an asynchronous user question. No implementation or dependency installation has started. The requested brainstorming skill requires a selected approach and approval of a concrete design document before implementation.

## Revision 2 reference follow-up

The x.ai/bot page became accessible in local Chrome with a standard desktop user agent; a full-page screenshot is saved as `references/xai-loaded.png`. Large whitespace, restrained black/white interface, teammate framing, feature demonstrations, role selector and expansive footer were observed. Some animated content was not fully resolved in the screenshot. TNova’s dedicated https://tnova.vn/ai-chatbot/ supplied fuller structural reference: channel requirements, knowledge sources, contextual dialogue, lead capture, handoff, preparation, deployment and FAQ. Rapiz copy is original and does not transfer TNova pricing, hospitality workflows, Telegram integration or availability promises.

The redesign uses Inter, oversized editorial type, a custom native SVG rabbit/orbit composition, graphite feature section, and expanded practical content. The user explicitly requested these revisions and retained delegated design decisions.
