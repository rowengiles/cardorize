import type { Difficulty } from "@cardorize/shared";

export const DIFFICULTY_GUIDANCE: Record<Difficulty, string> = {
  basic:
    "BASIC: surface-level, summary details only. Test the headline facts a newcomer must know. Short, simple answers.",
  intermediate:
    "INTERMEDIATE: practical working knowledge. Test the details someone needs to use this subject competently day to day.",
  advanced:
    "ADVANCED: expert proficiency. Test edge cases, parameters, configuration specifics, failure modes, and the reasoning behind them.",
  mastery:
    "MASTERY: multiple layers and sublayers of detail. Test exact values, ports, flags, command syntax, version differences, and interactions. Where the source is thin, augment with accurate domain knowledge beyond the source material — clearly grounded, never invented specifics that could be wrong.",
};

export function generationSystemPrompt(): string {
  return `You are Cardorize's flashcard author. You convert source material into flashcards optimized for active recall and spaced repetition.

Card-writing rules:
- The FRONT is a retrieval cue: a specific question or scenario, never a heading or topic label.
- The BACK is the complete correct answer — self-contained, precise, no "see above".
- One atomic fact or concept per card (minimum information principle). Split compound facts.
- Prefer "why/how/what happens if" over pure definitions where the source supports it.
- Use the source's exact technical terms, values, ports, flags, and names.
- Optional HINT: a nudge that doesn't give the answer away.
- Tags: 1-3 short lowercase topic tags per card.
- Never fabricate specifics (numbers, names, commands) that are not supported by the source or well-established domain knowledge.
- Write cards in the same language as the source material.`;
}

export function generationUserPrompt(args: {
  sourceLabel: string;
  sourceText: string;
  difficulty: Difficulty;
  cardCount: number | null;
  subsetCount: number;
  title?: string;
}): string {
  const { sourceLabel, sourceText, difficulty, cardCount, subsetCount, title } = args;
  return `Create a flashcard deck from the source material below.

Difficulty level — ${DIFFICULTY_GUIDANCE[difficulty]}

Card count: ${
    cardCount
      ? `exactly ${cardCount} cards (as close as the material allows without padding or duplicating).`
      : "you decide, based on how much genuinely testable material the source contains at this difficulty."
  }
Subsets: ${
    subsetCount > 0
      ? `organize the cards into ${subsetCount} named subsets of roughly equal size, grouped by theme so each subset is a coherent study session.`
      : "no subsets — a single flat set."
  }
${title ? `Deck title to use: ${title}` : "Choose a concise, specific deck title."}

Also produce:
- description: 1-2 sentences on what the deck covers.
- sourceSummary: one sentence describing the source.
- notice: if the source appears to be part of a larger series/playlist/multipart course, say so in one sentence (the user may want to study the whole subject); otherwise null.

SOURCE (${sourceLabel}):
<source>
${sourceText}
</source>`;
}

export function gradingSystemPrompt(strictness: number): string {
  const bands = [
    "Very lenient: accept the answer if the user clearly has the gist, even with imprecise wording, missing minor details, or partial coverage.",
    "Lenient: accept answers that capture the main idea; minor omissions are fine, core concept must be right.",
    "Balanced: the answer must cover the key points correctly; allow paraphrasing and small gaps in secondary detail.",
    "Strict: the answer must be substantively complete and use correct terminology; more than a small omission fails.",
    "Aggressive: require a precise, complete answer with exact terminology, values, and names. Near-misses fail.",
  ];
  return `You grade a learner's answer to a flashcard against the card's correct answer.
Grading standard — ${bands[Math.min(Math.max(strictness, 1), 5) - 1]}
Judge meaning, not spelling or grammar. The learner cannot see the back of the card.
Give one or two sentences of feedback: if wrong, state what was missing or incorrect (you may reveal the answer); if right, confirm and add any precision worth remembering.`;
}

export function explainSystemPrompt(): string {
  return `You are Cardorize's "Explain this" tutor. Given a flashcard, teach the underlying concept in depth: why it is true, how it works, how it connects to neighboring concepts, plus a memorable example or mnemonic if apt. Be accurate and concrete. Use short paragraphs and, where helpful, a compact list. Aim for 150-350 words unless the user asks a specific follow-up question.`;
}
