# Cardorize Roadmap

## Phase 1 — Web MVP (this repo, in progress)

- [x] Monorepo, shared schemas, security core (scrypt, TOTP, sessions, rate limiting)
- [x] Auth: username/password + optional TOTP
- [x] Decks/cards/subsets CRUD, public deck browsing + cloning
- [x] Ingestion: YouTube transcript, article URL, PDF/DOCX/TXT/MD upload, images (vision), pasted text; audio via Whisper (BYO OpenAI key)
- [x] AI generation with difficulty levels, card count, subsets (structured output)
- [x] Study modes: Memory, Leitner (5-stage), AI Mode with leniency; shuffle; server-persisted progress
- [x] "Explain this" deep dives
- [x] Settings: BYOK keys (encrypted), difficulty default, privacy, appearance, AI strictness
- [x] Social MVP: share deck/progress/achievement posts, feed, answer-a-card in feed, reposts
- [x] Reminders CRUD (in-app; push/email delivery is Phase 2)
- [x] Landing page with tagline + 1-2-3
- [x] Starter deck seeded on registration

## Phase 2 — Hardening + growth

- [ ] Server-authoritative study scoring (anti-cheat for gamification)
- [ ] Streaks, mastery badges, skill summary posts (AI-drafted)
- [ ] Notifications (web push) + reminder delivery + friend requests/alerts
- [ ] Interactive card formats: "which doesn't belong", ordering, missing-item, audio-question cards
- [ ] Combination-of-sources ingestion (multi-file + multi-URL in one job)
- [ ] YouTube playlist expansion ("this video is part of a series — study the whole subject?")
- [ ] X/Twitter thread + embedded-video ingestion
- [ ] Premium gating + Stripe ($5/mo, $49/yr, $199 lifetime)
- [ ] Postgres + BullMQ/Redis migration; media transcription vendor

## Phase 3 — Mobile + live capture

- [ ] Expo React Native app (portrait + landscape/tablet) — see MOBILE.md
- [ ] Live lecture/conference capture (record → transcribe → cards; optional photo attachments)
- [ ] Meeting connectors (Zoom, Meet, Teams, Slack, Telegram) via bot/webhook integrations
- [ ] Offline study with sync

## Deliberately deferred

- No user-generated free-form posts (spec: feed is cards/sets/progress/achievements only)
- No self-hosted media transcription (Whisper API first; local whisper.cpp evaluated later)
