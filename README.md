# Cardorize

**Any source. Instant flashcards. Lasting knowledge.**

Cardorize turns anything you're learning from — YouTube videos, articles, whitepapers, PDFs, Word docs, audio, screenshots, lectures — into study-ready flashcards using AI, then helps you master them with spaced repetition, active recall, and a social learning layer.

> Live domain (planned): `cardorize.ai` — all internal links are relative paths.

## How it works

1. **Add any source** — Paste a link or upload a file. YouTube · articles · whitepapers · wikis · PDFs · audio · video · lecture notes. Drop in whatever you're learning from.
2. **Get instant flashcards** — AI pulls out what matters and builds study-ready cards. Key ideas become Q&A cards in seconds — not hours of typing.
3. **Study for lasting knowledge** — Review with spaced repetition and active recall so it actually sticks. Practice at the right moment. Remember for the long term.

## Study modes

| Mode | Description |
|---|---|
| **Memory Mode** | Strict sequential review — flip cards front/back, progress auto-saves. |
| **Leitner Mode** | Leitner-system stage progression: clear all cards in stage 1 → they advance together to stage 2 → … → stage 5. Miss a card and it drops back to stage 1. Complete stage 5 to master the set. |
| **AI Mode** | No flipping — you type your answer and the AI grades it, with configurable leniency (from generous to exacting). |

All modes support card shuffling (interleaved practice) and server-side progress persistence — pick up exactly where you left off, on any device.

## Monorepo layout

```
apps/api        Fastify + TypeScript backend (Node 22+, SQLite via node:sqlite)
apps/web        Vite + React SPA
apps/mobile     (planned) Expo React Native app — see docs/MOBILE.md
packages/shared Shared zod schemas + TypeScript types
deploy/         NGINX + systemd deployment examples
docs/           Architecture, roadmap, progress log
```

## Quick start (dev)

Requires Node.js 22+ (built-in `node:sqlite` is used — no native deps).

```bash
npm install
npm run dev:api    # API on http://localhost:8787
npm run dev:web    # Web on http://localhost:5173 (proxies /api to the API)
```

Register an account (username / password, optional TOTP), then add your Anthropic API key under **Settings → AI Providers** to enable card generation, AI grading, and "Explain this". A starter deck is seeded on registration so you can try all three study modes immediately, no key required.

## Security posture (MVP)

- Passwords: scrypt (N=16384, r=8, p=1) with per-user salt
- 2FA: RFC 6238 TOTP (hand-rolled on `node:crypto`, no dependency)
- Sessions: 256-bit random tokens, stored hashed (SHA-256), httpOnly + SameSite cookies
- BYOK model API keys: AES-256-GCM encrypted at rest, never sent to the browser
- All SQL parameterized; all input validated with zod; Origin checked on mutations
- Uploads parsed then **deleted** — only generated cards are stored
- Token-bucket rate limiting on auth + AI endpoints; strict security headers

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), and [docs/PROGRESS.md](docs/PROGRESS.md).

## License

MIT — see [LICENSE](LICENSE).
