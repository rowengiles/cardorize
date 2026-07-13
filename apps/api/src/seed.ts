// Starter deck seeded on registration so every study mode is testable
// before the user adds an AI provider key.
import { db, nowIso } from "./db.js";
import { newId } from "./crypto.js";

const STARTER_CARDS: [front: string, back: string, hint: string | null][] = [
  [
    "What is active recall?",
    "Retrieving information from memory (e.g. answering a flashcard) rather than re-reading it. Retrieval practice strengthens the memory trace far more than passive review — this is the testing effect.",
    "It's what you're doing right now.",
  ],
  [
    "What is spaced repetition?",
    "Reviewing material at increasing intervals timed just before you would forget it, exploiting the spacing effect to flatten the Ebbinghaus forgetting curve.",
    null,
  ],
  [
    "What is the Leitner system?",
    "A spaced-repetition scheme using staged boxes: cards you answer correctly advance to the next stage; cards you miss return to stage 1. Cardorize's Leitner Mode implements it with 5 stages.",
    "Cardorize's Leitner Mode is named after it.",
  ],
  [
    "What is interleaved practice?",
    "Mixing the order of items or topics during study instead of blocking them together. Interleaving improves discrimination and long-term retention — it's why every Cardorize mode offers shuffle.",
    null,
  ],
  [
    "What is the forgetting curve?",
    "Hermann Ebbinghaus's finding that memory retention decays roughly exponentially over time without review — the curve that spaced repetition is designed to defeat.",
    "Ebbinghaus, 1885.",
  ],
  [
    "In Leitner Mode, what happens when you answer a card incorrectly?",
    "That card drops back to stage 1. When the current stage's round finishes, you return to stage 1 to work the missed cards forward again.",
    null,
  ],
  [
    "How does AI Mode differ from the other study modes?",
    "You can't flip the card. You type your answer and the AI grades it against the back of the card, with leniency you configure from 1 (gist is fine) to 5 (precise terminology required).",
    null,
  ],
  [
    "What does 'encoding specificity' mean for flashcard writing?",
    "Retrieval is best when cues at test match cues at encoding — so write card fronts as the cue you'll actually need in the real world (a question or scenario), not a heading.",
    null,
  ],
];

export function seedStarterDeck(userId: string) {
  const deckId = newId();
  db.prepare(
    "INSERT INTO decks (id, owner_id, title, description, difficulty, is_public, source_summary, created_at) VALUES (?,?,?,?,?,0,?,?)",
  ).run(
    deckId,
    userId,
    "Welcome to Cardorize: The Science of Remembering",
    "A starter set about the memory science behind Cardorize. Try all three study modes on it — no AI key needed.",
    "basic",
    "Seeded starter deck",
    nowIso(),
  );
  const insert = db.prepare(
    "INSERT INTO cards (id, deck_id, subset_id, position, front, back, hint, tags) VALUES (?,?,NULL,?,?,?,?,'[]')",
  );
  STARTER_CARDS.forEach(([front, back, hint], i) => {
    insert.run(newId(), deckId, i, front, back, hint);
  });
  return deckId;
}
