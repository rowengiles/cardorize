import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    plan TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    default_difficulty TEXT NOT NULL DEFAULT 'intermediate',
    privacy TEXT NOT NULL DEFAULT 'public',
    appearance TEXT NOT NULL DEFAULT 'default',
    ai_strictness INTEGER NOT NULL DEFAULT 3,
    generation_model TEXT NOT NULL DEFAULT 'claude-opus-4-8'
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, provider)
  );

  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT 'intermediate',
    is_public INTEGER NOT NULL DEFAULT 0,
    source_summary TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_decks_owner ON decks(owner_id);
  CREATE INDEX IF NOT EXISTS idx_decks_public ON decks(is_public, created_at);

  CREATE TABLE IF NOT EXISTS subsets (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_subsets_deck ON subsets(deck_id);

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    subset_id TEXT REFERENCES subsets(id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    hint TEXT,
    tags TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id, position);

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    step TEXT,
    payload TEXT NOT NULL,
    deck_id TEXT,
    error TEXT,
    notice TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at);

  CREATE TABLE IF NOT EXISTS study_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, deck_id, mode)
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
    card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    detail TEXT,
    repost_of TEXT REFERENCES posts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

  CREATE TABLE IF NOT EXISTS post_answers (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    correct INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_post_answers_post ON post_answers(post_id);

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    time TEXT NOT NULL,
    repeat TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Jobs interrupted by a restart are terminal — mark them failed so the UI unblocks.
db.prepare(
  `UPDATE jobs SET status='failed', error='Server restarted while the job was running. Please retry.', updated_at=? WHERE status IN ('queued','running')`,
).run(new Date().toISOString());

export function nowIso(): string {
  return new Date().toISOString();
}
