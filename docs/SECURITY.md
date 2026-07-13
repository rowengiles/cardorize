# Cardorize Security Notes

## Authentication

- **Passwords**: scrypt via `node:crypto` — N=16384, r=8, p=1, 64-byte key, 16-byte per-user salt, constant-time comparison. No password length cap below 8; max 128 to bound scrypt cost.
- **TOTP (RFC 6238)**: 20-byte base32 secret, SHA-1 HMAC, 30s step, ±1 window, 6 digits. Enabling requires a valid code; disabling requires a valid code. Implemented on `node:crypto` (no dependency).
- **Sessions**: 32-byte random tokens (base64url). Only the SHA-256 hash is stored server-side; a DB leak does not yield usable sessions. Cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day expiry, sliding renewal. Logout deletes the server record. Bearer tokens (same value) supported for mobile.

## Request hardening

- **Injection**: all SQL goes through prepared statements; all bodies validated with zod (types, lengths, enums) before touching logic.
- **XSS**: React escapes by default; no `dangerouslySetInnerHTML` anywhere; API sets `X-Content-Type-Options: nosniff`, a restrictive `Content-Security-Policy` for API responses, `Referrer-Policy`, `X-Frame-Options: DENY`.
- **CSRF**: SameSite cookies + Origin/Sec-Fetch-Site check on every mutating request + JSON-only bodies (no form encodings accepted).
- **Session hijacking**: hashed tokens, Secure cookies, no tokens in URLs, no session fixation (token issued only post-auth).
- **DoS**: token-bucket rate limits (tight on `/auth/*` and AI endpoints, general bucket elsewhere), body size limits (JSON 256 KB, uploads 50 MB), upload MIME/extension allowlist, per-user concurrent-job cap. NGINX in front adds connection limits + TLS.
- **SSRF (URL ingestion)**: only `http(s)` schemes; hostname resolved and checked against private/loopback/link-local ranges before fetch; redirects re-checked; response size capped.

## Secrets

- **BYOK model API keys**: AES-256-GCM with a key derived from `APP_SECRET` (HKDF-like via SHA-256 labels). Write-only API: clients can set/delete keys and see *which* providers are configured — never the key. Keys are decrypted only in-process at call time.
- `APP_SECRET`: from env in production; auto-generated and persisted to the data directory in dev.
- Uploads are written to the OS temp dir with random names and deleted in `finally` — retention is zero by design.

## Known MVP gaps (tracked in ROADMAP)

- Study scoring is client-computed (server persists) — fine for learning, must become server-authoritative before leaderboards/rewards matter.
- No email verification / password reset flow yet (needs an email provider decision).
- Rate limiting is per-process memory — needs a shared store when the API scales horizontally.
