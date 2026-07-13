import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  cardCreateSchema,
  cardUpdateSchema,
  deckCreateSchema,
  deckUpdateSchema,
  explainSchema,
} from "@cardorize/shared";
import { db, nowIso } from "../db.js";
import { newId } from "../crypto.js";
import { requireAuth } from "../auth.js";
import { rateLimit } from "../ratelimit.js";
import { AiError, explainCard } from "../ai/anthropic.js";

export function deckDto(row: any) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.username ?? "",
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    isPublic: !!row.is_public,
    cardCount: row.card_count ?? 0,
    sourceSummary: row.source_summary,
    createdAt: row.created_at,
  };
}

function cardDto(row: any) {
  return {
    id: row.id,
    deckId: row.deck_id,
    subsetId: row.subset_id,
    position: row.position,
    front: row.front,
    back: row.back,
    hint: row.hint,
    tags: JSON.parse(row.tags || "[]"),
  };
}

const DECK_SELECT = `
  SELECT d.*, u.username, (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS card_count
  FROM decks d JOIN users u ON u.id = d.owner_id
`;

export function loadDeck(deckId: string): any | undefined {
  return db.prepare(`${DECK_SELECT} WHERE d.id = ?`).get(deckId);
}

/** Owner always; others only when the deck is public. */
export function canViewDeck(deck: any, userId: string | undefined): boolean {
  return deck.owner_id === userId || !!deck.is_public;
}

function requireOwnedDeck(req: FastifyRequest, reply: FastifyReply): any | undefined {
  const { id } = req.params as { id: string };
  const deck = loadDeck(id);
  if (!deck || deck.owner_id !== req.userId) {
    reply.code(404).send({ error: "Deck not found" });
    return undefined;
  }
  return deck;
}

export function registerDeckRoutes(app: FastifyInstance) {
  const aiLimiter = rateLimit("ai-light", 20, 0.2);

  app.get("/api/decks", { preHandler: requireAuth }, async (req) => {
    const rows = db
      .prepare(`${DECK_SELECT} WHERE d.owner_id = ? ORDER BY d.created_at DESC`)
      .all(req.userId!);
    return { decks: rows.map(deckDto) };
  });

  app.get("/api/decks/public", { preHandler: requireAuth }, async (req) => {
    const rows = db
      .prepare(`${DECK_SELECT} WHERE d.is_public = 1 AND d.owner_id != ? ORDER BY d.created_at DESC LIMIT 50`)
      .all(req.userId!);
    return { decks: rows.map(deckDto) };
  });

  app.post("/api/decks", { preHandler: requireAuth }, async (req) => {
    const body = deckCreateSchema.parse(req.body);
    const id = newId();
    db.prepare(
      "INSERT INTO decks (id, owner_id, title, description, difficulty, is_public, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(id, req.userId!, body.title, body.description, body.difficulty, body.isPublic ? 1 : 0, nowIso());
    return { deck: deckDto(loadDeck(id)) };
  });

  app.get("/api/decks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deck = loadDeck(id);
    if (!deck || !canViewDeck(deck, req.userId)) return reply.code(404).send({ error: "Deck not found" });
    const subsets = db
      .prepare("SELECT id, name, position FROM subsets WHERE deck_id = ? ORDER BY position")
      .all(id);
    const cards = db.prepare("SELECT * FROM cards WHERE deck_id = ? ORDER BY position").all(id);
    return { deck: { ...deckDto(deck), subsets, cards: cards.map(cardDto) } };
  });

  app.patch("/api/decks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const deck = requireOwnedDeck(req, reply);
    if (!deck) return;
    const body = deckUpdateSchema.parse(req.body);
    db.prepare(
      "UPDATE decks SET title = ?, description = ?, difficulty = ?, is_public = ? WHERE id = ?",
    ).run(
      body.title ?? deck.title,
      body.description ?? deck.description,
      body.difficulty ?? deck.difficulty,
      body.isPublic === undefined ? deck.is_public : body.isPublic ? 1 : 0,
      deck.id,
    );
    return { deck: deckDto(loadDeck(deck.id)) };
  });

  app.delete("/api/decks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const deck = requireOwnedDeck(req, reply);
    if (!deck) return;
    db.prepare("DELETE FROM decks WHERE id = ?").run(deck.id);
    return { ok: true };
  });

  // Clone another user's public deck into your own library (aggregation feature).
  app.post("/api/decks/:id/clone", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deck = loadDeck(id);
    if (!deck || !canViewDeck(deck, req.userId)) return reply.code(404).send({ error: "Deck not found" });
    const newDeckId = newId();
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO decks (id, owner_id, title, description, difficulty, is_public, source_summary, created_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        newDeckId,
        req.userId!,
        `${deck.title}`,
        deck.description,
        deck.difficulty,
        0,
        `Cloned from @${deck.username}`,
        nowIso(),
      );
      const subsetMap = new Map<string, string>();
      const subsets = db.prepare("SELECT * FROM subsets WHERE deck_id = ? ORDER BY position").all(id) as any[];
      const insSubset = db.prepare("INSERT INTO subsets (id, deck_id, name, position) VALUES (?,?,?,?)");
      for (const s of subsets) {
        const sid = newId();
        subsetMap.set(s.id, sid);
        insSubset.run(sid, newDeckId, s.name, s.position);
      }
      const cards = db.prepare("SELECT * FROM cards WHERE deck_id = ? ORDER BY position").all(id) as any[];
      const insCard = db.prepare(
        "INSERT INTO cards (id, deck_id, subset_id, position, front, back, hint, tags) VALUES (?,?,?,?,?,?,?,?)",
      );
      for (const c of cards) {
        insCard.run(
          newId(),
          newDeckId,
          c.subset_id ? (subsetMap.get(c.subset_id) ?? null) : null,
          c.position,
          c.front,
          c.back,
          c.hint,
          c.tags,
        );
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return { deck: deckDto(loadDeck(newDeckId)) };
  });

  // --- Cards ---

  app.post("/api/decks/:id/cards", { preHandler: requireAuth }, async (req, reply) => {
    const deck = requireOwnedDeck(req, reply);
    if (!deck) return;
    const body = cardCreateSchema.parse(req.body);
    const max = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM cards WHERE deck_id = ?").get(deck.id) as {
      m: number;
    };
    const id = newId();
    db.prepare(
      "INSERT INTO cards (id, deck_id, subset_id, position, front, back, hint, tags) VALUES (?,?,?,?,?,?,?,?)",
    ).run(id, deck.id, body.subsetId ?? null, max.m + 1, body.front, body.back, body.hint ?? null, JSON.stringify(body.tags));
    return { card: cardDto(db.prepare("SELECT * FROM cards WHERE id = ?").get(id)) };
  });

  app.patch("/api/decks/:id/cards/:cardId", { preHandler: requireAuth }, async (req, reply) => {
    const deck = requireOwnedDeck(req, reply);
    if (!deck) return;
    const { cardId } = req.params as { cardId: string };
    const card = db.prepare("SELECT * FROM cards WHERE id = ? AND deck_id = ?").get(cardId, deck.id) as any;
    if (!card) return reply.code(404).send({ error: "Card not found" });
    const body = cardUpdateSchema.parse(req.body);
    db.prepare("UPDATE cards SET front = ?, back = ?, hint = ?, tags = ? WHERE id = ?").run(
      body.front ?? card.front,
      body.back ?? card.back,
      body.hint === undefined ? card.hint : (body.hint ?? null),
      body.tags ? JSON.stringify(body.tags) : card.tags,
      cardId,
    );
    return { card: cardDto(db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId)) };
  });

  app.delete("/api/decks/:id/cards/:cardId", { preHandler: requireAuth }, async (req, reply) => {
    const deck = requireOwnedDeck(req, reply);
    if (!deck) return;
    const { cardId } = req.params as { cardId: string };
    db.prepare("DELETE FROM cards WHERE id = ? AND deck_id = ?").run(cardId, deck.id);
    return { ok: true };
  });

  // --- "Explain this" deep dive ---

  app.post("/api/explain", { preHandler: [requireAuth, aiLimiter] }, async (req, reply) => {
    const body = explainSchema.parse(req.body);
    const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(body.cardId) as any;
    if (!card) return reply.code(404).send({ error: "Card not found" });
    const deck = loadDeck(card.deck_id);
    if (!deck || !canViewDeck(deck, req.userId)) return reply.code(404).send({ error: "Card not found" });
    try {
      const explanation = await explainCard({
        userId: req.userId!,
        front: card.front,
        back: card.back,
        question: body.question,
      });
      return { explanation };
    } catch (err) {
      if (err instanceof AiError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
