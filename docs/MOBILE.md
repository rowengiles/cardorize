# Cardorize Mobile Plan

Web ships first; mobile is planned adjacently so nothing on the web side blocks it.

## Stack

- **Expo React Native** (TypeScript) — same language as the rest of the product.
- Reuses `packages/shared` (zod schemas + types) and the same REST API — the API is already client-agnostic (cookie or bearer-token session, JSON in/out, relative paths).
- Navigation: expo-router. State: same lightweight fetch client as web (`apps/web/src/api.ts` will be lifted into `packages/shared/client` when mobile starts).

## Decisions already made in the API to keep mobile cheap

1. **Session tokens work as bearer tokens too** — `Authorization: Bearer <token>` is accepted alongside the cookie, so React Native (no cookie jar guarantees) uses SecureStore + bearer.
2. **No browser-only assumptions** — no redirects in API flows, all responses JSON, uploads are standard multipart.
3. **Study state is a JSON blob per (user, deck, mode)** — mobile reuses the exact mode logic (it lives in `packages/shared/src/study.ts`) and syncs the same state shape; offline queueing is a client concern.
4. **Relative paths everywhere** — mobile sets a single base URL (cardorize.ai) in one place.

## Screens (v1)

Dashboard · Create (paste link / upload / record) · Deck list + detail · Study (all 3 modes, portrait + landscape/tablet layouts) · Feed · Settings · Profile.

## Mobile-specific features (Phase 3)

- Live lecture capture: record with expo-av → upload → Whisper → cards (plus optional photos via camera roll multi-select).
- Push notifications for reminders and friend activity (expo-notifications).
- Offline study with background sync of study state.

## Responsiveness rules

- Portrait and landscape supported; tablets get a two-pane layout (deck list + study surface).
- The card flip surface uses the same interaction contract as web: tap to flip, swipe for next/prev, long-press for "Explain this".
