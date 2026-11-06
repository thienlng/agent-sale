# 19 — Installable app and device notifications (T-190)

The mobile app for the beta is the dashboard itself, installable as a PWA (ADR-009 "Mobile readiness": PWA during beta, React Native + Expo later). No separate code base: the same SPA, responsive down to phone width.

## Install

- `apps/web/public/manifest.webmanifest`: name Rapiz, `start_url` `/app/inbox`, `display: standalone`, theme `#f26b1d`, icons 192/512 and a maskable 512 (`public/icons/`, made from `logo.png`).
- `index.html` links the manifest and sets the Apple home-screen tags.
- `lib/pwa.ts` registers `/sw.js` at startup and keeps the browser's `beforeinstallprompt`. The header shows **Cài ứng dụng** (`components/install-app-button.tsx`) when the browser offers an install; on iPhone/iPad, where Safari has no prompt, it opens the three "Add to Home Screen" steps. Hidden inside the installed app.

## Device notifications (Web Push)

- `public/sw.js` caches nothing and handles no fetches (the app always loads from the network). It shows a push `{title, body, url, tag}` with the app icon and a monochrome badge, and a click focuses an open Rapiz window (navigating it to `url`) or opens one.
- The header bell switch (`features/notification/components/device-push-button.tsx`) turns notifications on for this device: it asks the browser permission, subscribes with the server's VAPID key (`GET /notifications/push`) and registers the subscription (`POST /notifications/push/subscriptions`). Turning it off unregisters and remembers the choice in `localStorage` (`rapiz.push.off`).
- `PushSync` (mounted in the app layout) re-registers the device quietly on every visit once permission is granted, also after the inbox's older **Bật thông báo** button granted it, so a renewed endpoint or another account of the same user keeps receiving.
- iOS delivers pushes only to the app added to the home screen (iOS 16.4+); in a Safari tab the switch points to the install steps.
- Server side: see `apps/backend/src/modules/notification/MODULE.md` (push channel, `push_subscriptions`, migration 0069) and `conversation/MODULE.md` (staff alerts).

## What is pushed

| Event | Type | To |
|---|---|---|
| The bot hands a conversation to staff | `inbox.handoff` "{customer} cần nhân viên hỗ trợ" | the assignee, else every active member with `contacts.edit` |
| A customer writes while staff hold the conversation (bot paused or off) | `inbox.message` "Tin nhắn mới từ {customer}" | same |
| Scheduled reports and assistant alerts (T-172) | `assistant.*` when the schedule asks for push | the account owner |

At most one alert per conversation and member every 5 minutes (one per handoff); the device groups pushes of one conversation. A click opens `/app/inbox?conversation=…&ws=…`, switching to that business first.

## Configuration

`WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` (a VAPID pair from `npx web-push generate-vapid-keys`) and `WEB_PUSH_SUBJECT` (default `mailto:support@rapiz.io`). Unset, the switch is hidden and push deliveries are skipped. Never rotate the pair casually: every registered device would need to subscribe again.
