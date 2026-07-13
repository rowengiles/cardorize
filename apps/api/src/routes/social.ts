import type { FastifyInstance } from "fastify";
import { feedAnswerSchema, postCreateSchema, reminderSchema } from "@cardorize/shared";
import { db, nowIso } from "../db.js";
import { newId } from "../crypto.js";
import { requireAuth } from "../auth.js";
import { rateLimit } from "../ratelimit.js";
import { AiError, getProviderKey, gradeAnswer } from "../ai/anthropic.js";
import { canViewDeck, deckDto, loadDeck } from "./decks.js";

function postDto(row: any) {
  const answers = db
    .prepare(
      `SELECT u.username, a.correct FROM post_answers a JOIN users u ON u.id = a.user_id
       WHERE a.post_id = ? ORDER BY a.created_at DESC LIMIT 20`,
    )
    .all(row.id) as { username: string; correct: number }[];
  return {
    id: row.id,
    username: row.username,
    type: row.type,
    deckId: row.deck_id,
    deckTitle: row.deck_title,
    cardId: row.card_id,
    cardFront: row.card_front,
    detail: row.detail,
    repostOf: row.repost_of,
    repostUsername: row.repost_username,
    createdAt: row.created_at,
    answers: answers.map((a) => ({ username: a.username, correct: !!a.correct })),
  };
}

const FEED_SELECT = `
  SELECT p.*, u.username, d.title AS deck_title, c.front AS card_front,
         ru.username AS repost_username
  FROM posts p
  JOIN users u ON u.id = p.user_id
  JOIN settings s ON s.user_id = p.user_id
  LEFT JOIN decks d ON d.id = p.deck_id
  LEFT JOIN cards c ON c.id = p.card_id
  LEFT JOIN posts rp ON rp.id = p.repost_of
  LEFT JOIN users ru ON ru.id = rp.user_id
`;

/** Word-overlap fallback grading for feed answers when the answerer has no AI key. */
function heuristicGrade(back: string, answer: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3);
  const backWords = new Set(norm(back));
  const answerWords = new Set(norm(answer));
  if (backWords.size === 0) return false;
  let hits = 0;
  for (const w of answerWords) if (backWords.has(w)) hits++;
  return hits / Math.min(backWords.size, Math.max(answerWords.size, 1)) >= 0.5;
}

export function registerSocialRoutes(app: FastifyInstance) {
  const postLimiter = rateLimit("post", 15, 0.1);

  // Feed: newest posts from public profiles (plus your own).
  app.get("/api/feed", { preHandler: requireAuth }, async (req) => {
    const rows = db
      .prepare(`${FEED_SELECT} WHERE (s.privacy = 'public' OR p.user_id = ?) ORDER BY p.created_at DESC LIMIT 50`)
      .all(req.userId!);
    return { posts: rows.map(postDto) };
  });

  app.post("/api/posts", { preHandler: [requireAuth, postLimiter] }, async (req, reply) => {
    const body = postCreateSchema.parse(req.body);
    let detail: string | null = null;
    let deckId: string | null = null;
    let cardId: string | null = null;

    if (body.type === "card") {
      if (!body.cardId) return reply.code(400).send({ error: "cardId required" });
      const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(body.cardId) as any;
      if (!card) return reply.code(404).send({ error: "Card not found" });
      const deck = loadDeck(card.deck_id);
      if (!deck || deck.owner_id !== req.userId) return reply.code(404).send({ error: "Card not found" });
      cardId = card.id;
      deckId = deck.id;
    } else {
      if (!body.deckId) return reply.code(400).send({ error: "deckId required" });
      const deck = loadDeck(body.deckId);
      if (!deck || deck.owner_id !== req.userId) return reply.code(404).send({ error: "Deck not found" });
      deckId = deck.id;

      if (body.type === "progress") {
        detail = computeProgressDetail(req.userId!, deck);
      } else if (body.type === "achievement") {
        // Server-verified: the ladder must actually be completed.
        const state = getLadderState(req.userId!, deck.id);
        if (!state?.completed) {
          return reply.code(400).send({ error: "Finish all 5 Ladder Mode stages first — then post it!" });
        }
        detail = `mastered all 5 stages of "${deck.title}" 🏆`;
      }
    }

    const id = newId();
    db.prepare(
      "INSERT INTO posts (id, user_id, type, deck_id, card_id, detail, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(id, req.userId!, body.type, deckId, cardId, detail, nowIso());
    const row = db.prepare(`${FEED_SELECT} WHERE p.id = ?`).get(id);
    return { post: postDto(row) };
  });

  app.post("/api/posts/:id/repost", { preHandler: [requireAuth, postLimiter] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const original = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as any;
    if (!original) return reply.code(404).send({ error: "Post not found" });
    const newPostId = newId();
    db.prepare(
      "INSERT INTO posts (id, user_id, type, deck_id, card_id, detail, repost_of, created_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      newPostId,
      req.userId!,
      original.type,
      original.deck_id,
      original.card_id,
      original.detail,
      original.repost_of ?? original.id,
      nowIso(),
    );
    const row = db.prepare(`${FEED_SELECT} WHERE p.id = ?`).get(newPostId);
    return { post: postDto(row) };
  });

  // Answer a card in the feed (cards in feeds can't be flipped — only answered).
  app.post("/api/posts/:id/answer", { preHandler: [requireAuth, postLimiter] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { answer } = feedAnswerSchema.parse(req.body);
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as any;
    if (!post?.card_id) return reply.code(404).send({ error: "That post has no answerable card" });
    const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(post.card_id) as any;
    if (!card) return reply.code(404).send({ error: "Card no longer exists" });

    let correct: boolean;
    let feedback: string | undefined;
    if (getProviderKey(req.userId!, "anthropic")) {
      try {
        const graded = await gradeAnswer({
          userId: req.userId!,
          front: card.front,
          back: card.back,
          answer,
          strictness: 3,
        });
        correct = graded.correct;
        feedback = graded.feedback;
      } catch (err) {
        if (err instanceof AiError) correct = heuristicGrade(card.back, answer);
        else throw err;
      }
    } else {
      correct = heuristicGrade(card.back, answer);
    }

    db.prepare(
      `INSERT INTO post_answers (id, post_id, user_id, correct, created_at) VALUES (?,?,?,?,?)`,
    ).run(newId(), id, req.userId!, correct ? 1 : 0, nowIso());
    return { correct, feedback: feedback ?? null };
  });

  // Public profile: user info + their public decks + recent achievements.
  app.get("/api/users/:username", { preHandler: requireAuth }, async (req, reply) => {
    const { username } = req.params as { username: string };
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
    if (!user) return reply.code(404).send({ error: "User not found" });
    const settings = db.prepare("SELECT privacy FROM settings WHERE user_id = ?").get(user.id) as {
      privacy: string;
    };
    const isSelf = user.id === req.userId;
    if (!isSelf && settings.privacy !== "public") {
      return reply.code(404).send({ error: "This profile is private" });
    }
    const decks = db
      .prepare(
        `SELECT d.*, u.username, (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS card_count
         FROM decks d JOIN users u ON u.id = d.owner_id
         WHERE d.owner_id = ? ${isSelf ? "" : "AND d.is_public = 1"} ORDER BY d.created_at DESC`,
      )
      .all(user.id);
    const achievements = db
      .prepare(`${FEED_SELECT} WHERE p.user_id = ? AND p.type IN ('achievement','progress') ORDER BY p.created_at DESC LIMIT 10`)
      .all(user.id);
    return {
      user: { username: user.username, createdAt: user.created_at },
      decks: decks.map(deckDto),
      achievements: achievements.map(postDto),
    };
  });

  // --- Reminders ---

  app.get("/api/reminders", { preHandler: requireAuth }, async (req) => {
    const rows = db.prepare("SELECT * FROM reminders WHERE user_id = ? ORDER BY time").all(req.userId!);
    return {
      reminders: (rows as any[]).map((r) => ({
        id: r.id,
        title: r.title,
        time: r.time,
        repeat: r.repeat,
        createdAt: r.created_at,
      })),
    };
  });

  app.post("/api/reminders", { preHandler: requireAuth }, async (req) => {
    const body = reminderSchema.parse(req.body);
    const id = newId();
    db.prepare("INSERT INTO reminders (id, user_id, title, time, repeat, created_at) VALUES (?,?,?,?,?,?)").run(
      id,
      req.userId!,
      body.title,
      body.time,
      body.repeat,
      nowIso(),
    );
    return { id };
  });

  app.put("/api/reminders/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = reminderSchema.parse(req.body);
    const result = db
      .prepare("UPDATE reminders SET title = ?, time = ?, repeat = ? WHERE id = ? AND user_id = ?")
      .run(body.title, body.time, body.repeat, id, req.userId!);
    if (result.changes === 0) return reply.code(404).send({ error: "Reminder not found" });
    return { ok: true };
  });

  app.delete("/api/reminders/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    db.prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?").run(id, req.userId!);
    return { ok: true };
  });
}

function getLadderState(userId: string, deckId: string): { completed?: boolean; stages?: Record<string, number> } | null {
  const row = db
    .prepare("SELECT state FROM study_state WHERE user_id = ? AND deck_id = ? AND mode = 'ladder'")
    .get(userId, deckId) as { state: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.state);
    // Clients store one state per scope; "all" is the whole-deck run.
    return parsed?.scopes?.all ?? parsed ?? null;
  } catch {
    return null;
  }
}

function computeProgressDetail(userId: string, deck: any): string {
  const state = getLadderState(userId, deck.id);
  const total = (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE deck_id = ?").get(deck.id) as { n: number }).n;
  if (state?.stages) {
    const mastered = Object.values(state.stages).filter((s) => s >= 6).length;
    return `has memorized ${mastered} of ${total} cards in "${deck.title}"`;
  }
  return `is studying "${deck.title}" (${total} cards)`;
}
