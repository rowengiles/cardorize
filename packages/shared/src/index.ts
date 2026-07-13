import { z } from "zod";

// ---------- Core enums ----------

export const DIFFICULTIES = ["basic", "intermediate", "advanced", "mastery"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const STUDY_MODES = ["memory", "ladder", "ai"] as const;
export type StudyMode = (typeof STUDY_MODES)[number];

export const PRIVACY_LEVELS = ["public", "link", "friends", "private"] as const;
export type Privacy = (typeof PRIVACY_LEVELS)[number];

export const APPEARANCES = ["default", "midnight", "paper", "ocean"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const AI_PROVIDERS = ["anthropic", "openai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const MODE_LABELS: Record<StudyMode, string> = {
  memory: "Memory Mode",
  ladder: "Ladder Mode",
  ai: "AI Mode",
};

// ---------- Entities (API response shapes) ----------

export interface PublicUser {
  id: string;
  username: string;
  createdAt: string;
  totpEnabled: boolean;
  plan: "free" | "premium" | "lifetime";
}

export interface Subset {
  id: string;
  name: string;
  position: number;
}

export interface Card {
  id: string;
  deckId: string;
  subsetId: string | null;
  position: number;
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
}

export interface Deck {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  isPublic: boolean;
  cardCount: number;
  sourceSummary: string | null;
  createdAt: string;
  subsets?: Subset[];
  cards?: Card[];
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  step: string | null;
  deckId: string | null;
  error: string | null;
  notice: string | null;
  createdAt: string;
}

export interface FeedPost {
  id: string;
  username: string;
  type: "deck" | "card" | "progress" | "achievement";
  deckId: string | null;
  deckTitle: string | null;
  cardId: string | null;
  cardFront: string | null;
  detail: string | null;
  repostOf: string | null;
  repostUsername: string | null;
  createdAt: string;
  answers: { username: string; correct: boolean }[];
}

export interface Reminder {
  id: string;
  title: string;
  time: string; // HH:MM 24h
  repeat: "daily" | "weekly";
  createdAt: string;
}

export interface UserSettings {
  defaultDifficulty: Difficulty;
  privacy: Privacy;
  appearance: Appearance;
  aiStrictness: number; // 1..5
  providers: AiProvider[]; // which BYOK keys are configured (never the keys)
  generationModel: string;
}

// ---------- Input schemas ----------

export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_]+$/, "letters, numbers and underscores only");

export const registerSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(128),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const deckCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  difficulty: z.enum(DIFFICULTIES).default("intermediate"),
  isPublic: z.boolean().default(false),
});

export const deckUpdateSchema = deckCreateSchema.partial();

export const cardCreateSchema = z.object({
  front: z.string().min(1).max(4000),
  back: z.string().min(1).max(8000),
  hint: z.string().max(1000).nullish(),
  subsetId: z.string().nullish(),
  tags: z.array(z.string().max(50)).max(10).default([]),
});

export const cardUpdateSchema = cardCreateSchema.partial();

export const generationOptionsSchema = z.object({
  title: z.string().max(200).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(), // falls back to user default
  cardCount: z.number().int().min(4).max(500).nullish(), // null = AI decides
  subsetCount: z.number().int().min(0).max(20).default(0),
  isPublic: z.boolean().default(false),
});
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;

export const sourceCreateSchema = z.object({
  kind: z.enum(["url", "text"]),
  url: z.string().url().max(2000).optional(),
  text: z.string().max(400_000).optional(),
  options: generationOptionsSchema.default({}),
});

export const gradeSchema = z.object({
  cardId: z.string(),
  answer: z.string().min(1).max(4000),
  strictness: z.number().int().min(1).max(5).optional(),
});

export const explainSchema = z.object({
  cardId: z.string(),
  question: z.string().max(2000).optional(),
});

export const settingsUpdateSchema = z.object({
  defaultDifficulty: z.enum(DIFFICULTIES).optional(),
  privacy: z.enum(PRIVACY_LEVELS).optional(),
  appearance: z.enum(APPEARANCES).optional(),
  aiStrictness: z.number().int().min(1).max(5).optional(),
  generationModel: z.string().max(100).optional(),
});

export const apiKeySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  key: z.string().min(10).max(500),
});

export const postCreateSchema = z.object({
  type: z.enum(["deck", "card", "progress", "achievement"]),
  deckId: z.string().optional(),
  cardId: z.string().optional(),
});

export const feedAnswerSchema = z.object({
  answer: z.string().min(1).max(4000),
});

export const reminderSchema = z.object({
  title: z.string().min(1).max(200),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  repeat: z.enum(["daily", "weekly"]),
});

export const studyStateSchema = z.object({
  state: z.unknown(), // mode-specific JSON, bounded server-side by size
});

export * from "./study.js";
