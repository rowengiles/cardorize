import type { FastifyInstance } from "fastify";
import { apiKeySchema, settingsUpdateSchema, AI_PROVIDERS } from "@cardorize/shared";
import { db, nowIso } from "../db.js";
import { encryptSecret } from "../crypto.js";
import { requireAuth } from "../auth.js";

function settingsDto(userId: string) {
  const row = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(userId) as any;
  const providers = (
    db.prepare("SELECT provider FROM api_keys WHERE user_id = ?").all(userId) as { provider: string }[]
  ).map((r) => r.provider);
  return {
    defaultDifficulty: row.default_difficulty,
    privacy: row.privacy,
    appearance: row.appearance,
    aiStrictness: row.ai_strictness,
    generationModel: row.generation_model,
    providers,
  };
}

export function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", { preHandler: requireAuth }, async (req) => {
    return { settings: settingsDto(req.userId!) };
  });

  app.put("/api/settings", { preHandler: requireAuth }, async (req) => {
    const body = settingsUpdateSchema.parse(req.body);
    const current = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.userId!) as any;
    db.prepare(
      `UPDATE settings SET default_difficulty = ?, privacy = ?, appearance = ?, ai_strictness = ?, generation_model = ? WHERE user_id = ?`,
    ).run(
      body.defaultDifficulty ?? current.default_difficulty,
      body.privacy ?? current.privacy,
      body.appearance ?? current.appearance,
      body.aiStrictness ?? current.ai_strictness,
      body.generationModel ?? current.generation_model,
      req.userId!,
    );
    return { settings: settingsDto(req.userId!) };
  });

  // BYOK keys are write-only: stored AES-256-GCM encrypted, never returned.
  app.put("/api/settings/keys", { preHandler: requireAuth }, async (req) => {
    const body = apiKeySchema.parse(req.body);
    db.prepare(
      `INSERT INTO api_keys (user_id, provider, ciphertext, created_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = excluded.created_at`,
    ).run(req.userId!, body.provider, encryptSecret(body.key), nowIso());
    return { settings: settingsDto(req.userId!) };
  });

  app.delete("/api/settings/keys/:provider", { preHandler: requireAuth }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!AI_PROVIDERS.includes(provider as (typeof AI_PROVIDERS)[number])) {
      return reply.code(400).send({ error: "Unknown provider" });
    }
    db.prepare("DELETE FROM api_keys WHERE user_id = ? AND provider = ?").run(req.userId!, provider);
    return { settings: settingsDto(req.userId!) };
  });
}
