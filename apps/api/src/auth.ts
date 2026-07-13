import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { loginSchema, registerSchema, totpCodeSchema } from "@cardorize/shared";
import { db, nowIso } from "./db.js";
import { config } from "./config.js";
import {
  hashPassword,
  hashToken,
  newId,
  newSessionToken,
  newTotpSecret,
  totpUri,
  verifyPassword,
  verifyTotp,
} from "./crypto.js";
import { rateLimit } from "./ratelimit.js";
import { seedStarterDeck } from "./seed.js";

export interface UserRow {
  id: string;
  username: string;
  pass_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
  plan: string;
  created_at: string;
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    user?: UserRow;
  }
}

const COOKIE = "cz_session";

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function createSession(reply: FastifyReply, userId: string): string {
  const { token, tokenHash } = newSessionToken();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)").run(
    tokenHash,
    userId,
    nowIso(),
    Date.now() + config.sessionTtlMs,
  );
  setSessionCookie(reply, token);
  return token;
}

/** onRequest hook: resolves the session (cookie or bearer) into req.user. */
export async function attachUser(req: FastifyRequest) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = (req.cookies?.[COOKIE] as string | undefined) ?? bearer;
  if (!token) return;
  const row = db
    .prepare("SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .get(hashToken(token)) as (UserRow & { expires_at: number }) | undefined;
  if (!row) return;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    return;
  }
  // Sliding renewal once the session is >1 day old.
  if (row.expires_at - Date.now() < config.sessionTtlMs - 24 * 60 * 60 * 1000) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(
      Date.now() + config.sessionTtlMs,
      hashToken(token),
    );
  }
  req.userId = row.id;
  req.user = row;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.userId) return reply.code(401).send({ error: "Not signed in" });
}

function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    createdAt: u.created_at,
    totpEnabled: !!u.totp_enabled,
    plan: u.plan,
  };
}

export function registerAuthRoutes(app: FastifyInstance) {
  const authLimiter = rateLimit("auth", 10, 0.2); // 10 burst, 1 request / 5s sustained

  app.post("/api/auth/register", { preHandler: authLimiter }, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(body.username);
    if (exists) return reply.code(409).send({ error: "That username is taken" });
    const id = newId();
    db.prepare("INSERT INTO users (id, username, pass_hash, created_at) VALUES (?,?,?,?)").run(
      id,
      body.username,
      await hashPassword(body.password),
      nowIso(),
    );
    db.prepare("INSERT INTO settings (user_id) VALUES (?)").run(id);
    seedStarterDeck(id);
    createSession(reply, id);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow;
    return { user: publicUser(user) };
  });

  app.post("/api/auth/login", { preHandler: authLimiter }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(body.username) as
      | UserRow
      | undefined;
    // Uniform error to avoid username enumeration.
    if (!user || !(await verifyPassword(body.password, user.pass_hash))) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    if (user.totp_enabled) {
      if (!body.totp) return reply.code(401).send({ requiresTotp: true, error: "TOTP code required" });
      if (!verifyTotp(user.totp_secret!, body.totp)) {
        return reply.code(401).send({ requiresTotp: true, error: "Invalid TOTP code" });
      }
    }
    const token = createSession(reply, user.id);
    return { user: publicUser(user), token };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = (req.cookies?.[COOKIE] as string | undefined) ?? undefined;
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Not signed in" });
    return { user: publicUser(req.user) };
  });

  // --- TOTP enrollment ---

  app.post("/api/auth/totp/setup", { preHandler: [requireAuth, authLimiter] }, async (req) => {
    const secret = newTotpSecret();
    db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?").run(secret, req.userId!);
    return { secret, otpauth: totpUri(req.user!.username, secret) };
  });

  app.post("/api/auth/totp/enable", { preHandler: [requireAuth, authLimiter] }, async (req, reply) => {
    const { code } = totpCodeSchema.parse(req.body);
    const user = req.user!;
    if (!user.totp_secret) return reply.code(400).send({ error: "Run TOTP setup first" });
    if (!verifyTotp(user.totp_secret, code)) return reply.code(400).send({ error: "Invalid code" });
    db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(user.id);
    return { ok: true };
  });

  app.post("/api/auth/totp/disable", { preHandler: [requireAuth, authLimiter] }, async (req, reply) => {
    const { code } = totpCodeSchema.parse(req.body);
    const user = req.user!;
    if (!user.totp_enabled || !user.totp_secret) return reply.code(400).send({ error: "TOTP is not enabled" });
    if (!verifyTotp(user.totp_secret, code)) return reply.code(400).send({ error: "Invalid code" });
    db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").run(user.id);
    return { ok: true };
  });
}
