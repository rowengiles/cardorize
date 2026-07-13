// Pure study-mode logic, shared by web (and later mobile).
// Academic grounding: Memory Mode = sequential active recall (testing effect);
// Ladder Mode = Leitner system (graduated-interval retrieval practice);
// shuffling = interleaved practice.

export const LADDER_STAGES = 5;

export interface MemoryState {
  mode: "memory";
  order: string[];
  index: number;
  shuffled: boolean;
}

export interface LadderState {
  mode: "ladder";
  /** cardId -> stage 1..5; 6 means mastered (cleared stage 5) */
  stages: Record<string, number>;
  /** stage currently being tested */
  roundStage: number;
  /** cardIds remaining in the current round */
  round: string[];
  /** answered correctly this round — advance together when the round ends */
  pending: string[];
  shuffled: boolean;
  completed: boolean;
}

export interface AiModeState {
  mode: "ai";
  order: string[];
  index: number;
  shuffled: boolean;
  results: Record<string, { correct: boolean; attempts: number }>;
}

export type AnyStudyState = MemoryState | LadderState | AiModeState;

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function initMemory(cardIds: string[], shuffled: boolean): MemoryState {
  return { mode: "memory", order: shuffled ? shuffleArray(cardIds) : [...cardIds], index: 0, shuffled };
}

export function initAiMode(cardIds: string[], shuffled: boolean): AiModeState {
  return { mode: "ai", order: shuffled ? shuffleArray(cardIds) : [...cardIds], index: 0, shuffled, results: {} };
}

export function initLadder(cardIds: string[], shuffled: boolean): LadderState {
  const stages: Record<string, number> = {};
  for (const id of cardIds) stages[id] = 1;
  const round = shuffled ? shuffleArray(cardIds) : [...cardIds];
  return { mode: "ladder", stages, roundStage: 1, round, pending: [], shuffled, completed: false };
}

/** The card currently being tested in Ladder Mode, or null when the set is complete. */
export function ladderCurrentCard(s: LadderState): string | null {
  return s.completed ? null : (s.round[0] ?? null);
}

/**
 * Apply an answer in Ladder Mode. Correct cards advance together when the round
 * ends; a miss sends that card back to stage 1 (per spec). Returns a new state.
 */
export function ladderAnswer(s: LadderState, cardId: string, correct: boolean): LadderState {
  if (s.completed || s.round[0] !== cardId) return s;
  const next: LadderState = {
    ...s,
    stages: { ...s.stages },
    round: s.round.slice(1),
    pending: [...s.pending],
  };
  if (correct) next.pending.push(cardId);
  else next.stages[cardId] = 1;

  if (next.round.length === 0) {
    // Round complete: pending cards move up together.
    for (const id of next.pending) {
      next.stages[id] = Math.min(next.stages[id] + 1, LADDER_STAGES + 1);
    }
    next.pending = [];
    // Next round: lowest stage that still has unmastered cards (missed cards
    // sit at stage 1, so the user returns there to push them forward again).
    const remaining = Object.entries(next.stages).filter(([, st]) => st <= LADDER_STAGES);
    if (remaining.length === 0) {
      next.completed = true;
      next.roundStage = LADDER_STAGES;
      next.round = [];
    } else {
      const minStage = Math.min(...remaining.map(([, st]) => st));
      next.roundStage = minStage;
      const ids = remaining.filter(([, st]) => st === minStage).map(([id]) => id);
      next.round = next.shuffled ? shuffleArray(ids) : ids;
    }
  }
  return next;
}

export function ladderStageCounts(s: LadderState): number[] {
  // index 0..4 = stages 1..5, index 5 = mastered
  const counts = [0, 0, 0, 0, 0, 0];
  for (const st of Object.values(s.stages)) counts[Math.min(st, 6) - 1]++;
  return counts;
}

export function ladderProgressPct(s: LadderState): number {
  const total = Object.keys(s.stages).length;
  if (total === 0) return 0;
  // Each stage cleared contributes 1/5 of a card's journey.
  const points = Object.values(s.stages).reduce((sum, st) => sum + (Math.min(st, 6) - 1), 0);
  return Math.round((points / (total * LADDER_STAGES)) * 100);
}
