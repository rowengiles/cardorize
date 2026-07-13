# Cardorize Progress Log

> This file is the authoritative session-to-session status record. Newest entries first.
> Claude: read this file first when resuming work in a new session.

---

## 2026-07-12 — Session 1: Foundation + Web MVP

**Environment**: Installed Node.js 24.18.0 via winget (machine had none). git 2.54 present. gh CLI not installed — repo publish pending user GitHub auth.

**Decisions made** (user delegated stack/naming choices):
- TypeScript monorepo (npm workspaces): `apps/api` Fastify + `node:sqlite`, `apps/web` Vite+React SPA, `packages/shared` zod schemas, Expo RN planned for mobile.
- Mode 2 named **"Leitner Mode"** — user confirmed this name end of session (internal mode key stays `ladder`).
- Default model `claude-opus-4-8` via official `@anthropic-ai/sdk`; structured outputs for card JSON; streaming for generation.
- Hand-rolled: TOTP, scrypt hashing, AES-256-GCM key encryption, rate limiting, dotenv (dependency minimization per spec).
- Uploads: temp file → parse → delete; only cards persist.
- Study state: JSON per (user, deck, mode), client-computed, server-persisted (server-authoritative scoring deferred to Phase 2).

**Built this session**:
- Repo scaffold, docs (ARCHITECTURE, ROADMAP, MOBILE, SECURITY, this file), LICENSE (MIT), NGINX deploy example.
- `packages/shared`: all zod schemas/types + pure study-mode logic (ladder transitions etc.).
- `apps/api`: config, db (full schema), crypto (scrypt/TOTP/AES-GCM/tokens), auth routes + session middleware, rate limiting, security headers, decks/cards CRUD + clone + explain, study state + AI grading, sources/jobs ingestion pipeline (YouTube, article, PDF, DOCX, TXT/MD, images, audio-via-Whisper, pasted text), Anthropic integration (generate/grade/explain), settings (BYOK encrypted), social (posts/feed/answers/reposts), reminders, starter deck seed.
- `apps/web`: landing page (tagline + how-it-works 1-2-3), auth (register/login/TOTP), dashboard, create-from-source flow with job polling, deck list/detail, study UI (3D flip, three modes, shuffle, progress), feed, settings, profile stub.

**Verified (all passing)**:
- `npm run typecheck` clean for API + web; `vite build` production bundle 80 KB gzipped.
- Browser walkthrough: landing page → register (`rowen_demo`) → dashboard with seeded starter deck → Memory Mode (flip/next, progress persisted across full page reload at "Card 3 of 8") → Ladder Mode (full stage-1 round: 7 correct advanced together to stage 2, 1 miss dropped to stage 1, next round correctly returned to stage 1; 18% mastery) → AI Mode shows friendly "add key in Settings" error without a key → deck share + card post → feed shows posts, card answered via heuristic fallback grading, "answered this correctly ✓" comment appears → Settings renders all sections.
- Scripted API test (scratchpad totp-e2e.mjs): register, TOTP setup, enable with real RFC-6238 code, login blocked without code, uniform 401 on bad password, login with code, session valid — 7/7 PASS.
- NOT yet verified (needs a real Anthropic key): live card generation from URL/upload, AI grading quality, Explain This output. Code paths typecheck and fail gracefully without keys.

**Repo status**: PUBLISHED — https://github.com/rowengiles/cardorize (user created the repo and authenticated gh as `rowengiles`; all commits pushed, `main` tracks `origin/main`).

**Post-review changes (2026-07-13)**:
- Mode 2 renamed to **"Leitner Mode"** (user's choice; internal key stays `ladder`).
- Audio/mp4 uploads now prompt for the Whisper (OpenAI) key **at upload time**: inline alert + key entry on the Create page, and the upload endpoint rejects up front with 402 ("This is an audio/video upload. Please enter your Whisper (OpenAI) API key to allow transcribing.") — verified by scripted test (PASS).

**Next session (Phase 2 candidates)**:
1. Add repo description + topics on GitHub; consider enabling branch protection.
2. User decisions pending: premium gating boundaries per feature; email provider for verification/reset.
3. Interactive card formats; playlist expansion prompt; friend system; streaks/badges engine; verify live AI generation once the user adds their Anthropic key.

---
