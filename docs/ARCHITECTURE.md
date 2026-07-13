# Cardorize Architecture

## Guiding constraints (from product spec)

- One language across the product → **TypeScript everywhere** (API, web, future mobile share `packages/shared`).
- Fastest, most secure MVP; strong at async work and file handling → **Node 22+ / Fastify**.
- Servable behind **NGINX** → static SPA + reverse-proxied API (see `deploy/nginx.conf.example`).
- Minimize dependency surface → hand-rolled where cheap (TOTP, scrypt hashing, rate limiting, AES-GCM key encryption, dotenv); dependencies only where they clearly win (Fastify, zod, official Anthropic SDK, pdfjs-dist, mammoth).
- Model API keys **never** reach the browser or mobile app. The backend accepts a source, extracts/transcribes, calls the LLM, returns structured flashcards (JSON schema), and discards uploads.

## System diagram

```
Browser SPA / Mobile app
        │  (cookies, JSON, relative /api paths)
        ▼
      NGINX ──► static files (apps/web/dist)
        │
        ▼ /api
   Fastify API (apps/api)
   ├─ auth: scrypt + TOTP + hashed session tokens
   ├─ decks/cards/subsets CRUD
   ├─ study state per (user, deck, mode)
   ├─ social: posts, feed, answers, reminders
   ├─ settings incl. encrypted BYOK keys
   └─ ingestion job queue (DB-backed, in-process workers)
        │
        ├─ extractors: YouTube transcript · article HTML · PDF (pdfjs) ·
        │              DOCX (mammoth) · TXT/MD · images (Claude vision) ·
        │              audio (OpenAI Whisper, if user saved an OpenAI key)
        │
        └─ Anthropic Messages API (user's key, default model claude-opus-4-8)
             ├─ generateCards  → structured output (JSON schema)
             ├─ gradeAnswer    → AI Mode grading with leniency 1–5
             ├─ explain        → "Explain this" deep dives
             └─ skillSummary   → optional profile skill summary
        │
        ▼
   SQLite (node:sqlite, WAL) → Postgres is the scale-up path
```

## Key decisions

| Decision | Rationale |
|---|---|
| `node:sqlite` (built-in) | Zero native deps, WAL mode is plenty for MVP; the data layer is a thin module (`db.ts`) so swapping to Postgres later touches one file. |
| DB-backed job queue, in-process worker | No Redis to deploy; jobs survive restarts as failed-and-retryable records. BullMQ/Redis is the scale-up path. |
| Uploads → temp file → parse → **delete** | Product requirement: keep only the flashcards. Nothing user-uploaded persists. |
| Study state stored as JSON per (user, deck, mode) | Modes evolve fast; client computes transitions, server persists + bounds size. Server-authoritative scoring is a later hardening step (matters for gamification integrity). |
| Structured outputs (`output_config.format`) for card generation | Guarantees parseable card JSON — no regex extraction from prose. |
| BYOK keys AES-256-GCM encrypted, write-only API | Settings endpoint returns only which providers are configured, never key material. |

## Study mode semantics

- **Memory Mode** (`memory`): strict sequential; state = `{order, index}`. Flip = self-graded exposure (the *testing effect* still applies via active recall on the front side).
- **Ladder Mode** (`ladder`): Leitner system. Every card has stage 1–5. A round tests all cards of the lowest incomplete stage; cards answered correctly are queued to advance *together* at round end; any miss sends that card to stage 1. Set is complete when every card has cleared stage 5. This implements graduated-interval retrieval practice.
- **AI Mode** (`ai`): no flipping; the user's typed answer is graded by the model with strictness 1 (lenient — gist suffices) to 5 (aggressive — precise terminology required).

All modes support shuffling (interleaving) and resume-from-anywhere via persisted state.

## Ingestion pipeline

`POST /api/sources` (URL/text) or `POST /api/sources/upload` (multipart) → job row (`queued`) → in-process worker:

1. **Extract** — dispatch on source type: YouTube link → timedtext transcript; other URLs → HTML → readability-lite text; PDF/DOCX/TXT/MD → text; images → passed as vision blocks; audio/video → Whisper transcription (requires user's OpenAI key).
2. **Generate** — one Anthropic streaming call with the user's difficulty (basic/intermediate/advanced/mastery), requested card count (or AI-decided), and subset layout; mastery level may augment with model knowledge beyond the source (per spec).
3. **Persist** — deck + subsets + cards written transactionally; job → `done` with `deckId`.
4. **Clean up** — temp upload deleted in a `finally` block.

Multipart-series detection (e.g. a video that is part of a playlist) is surfaced as `job.notice` for the UI to offer "study the whole subject" (roadmap: interactive follow-up).

## Scale-up path (documented, not built)

SQLite → Postgres; in-process jobs → BullMQ + Redis; single node → API replicas behind NGINX; transcript/transcription vendors (e.g. Deepgram) for heavy media; WebSocket for live feed updates (currently polling); server-authoritative study scoring; Stripe for premium billing.
