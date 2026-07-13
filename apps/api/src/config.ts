import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

// Minimal .env loader (no dependency): KEY=VALUE lines, # comments.
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv(path.resolve(process.cwd(), ".env"));

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "./data");
mkdirSync(dataDir, { recursive: true });

function resolveAppSecret(): string {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 32) return process.env.APP_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET (32+ chars) is required in production");
  }
  // Dev convenience: generate once and persist so encrypted keys survive restarts.
  const secretFile = path.join(dataDir, "dev-secret.key");
  if (existsSync(secretFile)) return readFileSync(secretFile, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "127.0.0.1",
  dataDir,
  dbFile: path.join(dataDir, "cardorize.db"),
  appSecret: resolveAppSecret(),
  isProd: process.env.NODE_ENV === "production",
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days, sliding
  maxUploadBytes: 50 * 1024 * 1024,
  maxStudyStateBytes: 512 * 1024,
};
