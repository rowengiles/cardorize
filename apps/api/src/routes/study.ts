import type { FastifyInstance } from "fastify";
import { STUDY_MODES, gradeSchema, studyStateSchema, type StudyMode } from "@cardorize/shared";
import { db, nowIso } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../auth.js";
import { rateLimit } from "../ratelimit.js";
import { AiError, gradeAnswer } from "../ai/anthropic.js";
import { canViewDeck, loadDeck } from "./decks.js";

export function registerStudyRoutes(app: FastifyInstance) {
  const gradeLimiter = rateLimit("grade", 30, 0.5);

  // Resume-anywhere: fetch saved state for a deck+mode.
  app.get("/api/study/:deckId/:mode", { preHandler: requireAuth }, async (req, reply) => {
    const { deckId, mode } = req.params as { deckId: string; mode: string };
    if (!STUDY_MODES.includes(mode as StudyMode)) return reply.code(400).send({ error: "Unknown mode" });
    const deck = loadDeck(deckId);
    if (!deck || !canViewDeck(deck, req.userId)) return reply.code(404).send({ error: "Deck not found" });
    const row = db
      .prepare("SELECT state, updated_at FROM study_state WHERE user_id = ? AND deck_id = ? AND mode = ?")
      .get(req.userId!, deckId, mode) as { state: string; updated_at: string } | undefined;
    return { state: row ? JSON.parse(row.state) : null, updatedAt: row?.updated_at ?? null };
  });

  // Persist progress (auto-saved by the client after every answer/flip).
  app.put("/api/study/:deckId/:mode", { preHandler: requireAuth }, async (req, reply) => {
    const { deckId, mode } = req.params as { deckId: string; mode: string };
    if (!STUDY_MODES.includes(mode as StudyMode)) return reply.code(400).send({ error: "Unknown mode" });
    const deck = loadDeck(deckId);
    if (!deck || !canViewDeck(deck, req.userId)) return reply.code(404).send({ error: "Deck not found" });
    const { state } = studyStateSchema.parse(req.body);
    const serialized = JSON.stringify(state ?? null);
    if (serialized.length > config.maxStudyStateBytes) {
      return reply.code(413).send({ error: "Study state too large" });
    }
    db.prepare(
      `INSERT INTO study_state (user_id, deck_id, mode, state, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, deck_id, mode) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    ).run(req.userId!, deckId, mode, serialized, nowIso());
    return { ok: true };
  });

  app.delete("/api/study/:deckId/:mode", { preHandler: requireAuth }, async (req, reply) => {
    const { deckId, mode } = req.params as { deckId: string; mode: string };
    if (!STUDY_MODES.includes(mode as StudyMode)) return reply.code(400).send({ error: "Unknown mode" });
    db.prepare("DELETE FROM study_state WHERE user_id = ? AND deck_id = ? AND mode = ?").run(
      req.userId!,
      deckId,
      mode,
    );
    return { ok: true };
  });

  // AI Mode grading: the card back is never sent to the client before answering.
  app.post("/api/study/:deckId/grade", { preHandler: [requireAuth, gradeLimiter] }, async (req, reply) => {
    const { deckId } = req.params as { deckId: string };
    const body = gradeSchema.parse(req.body);
    const deck = loadDeck(deckId);
    if (!deck || !canViewDeck(deck, req.userId)) return reply.code(404).send({ error: "Deck not found" });
    const card = db.prepare("SELECT * FROM cards WHERE id = ? AND deck_id = ?").get(body.cardId, deckId) as any;
    if (!card) return reply.code(404).send({ error: "Card not found" });

    const settings = db.prepare("SELECT ai_strictness FROM settings WHERE user_id = ?").get(req.userId!) as
      | { ai_strictness: number }
      | undefined;
    const strictness = body.strictness ?? settings?.ai_strictness ?? 3;

    try {
      const result = await gradeAnswer({
        userId: req.userId!,
        front: card.front,
        back: card.back,
        answer: body.answer,
        strictness,
      });
      return { ...result, back: card.back };
    } catch (err) {
      if (err instanceof AiError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
