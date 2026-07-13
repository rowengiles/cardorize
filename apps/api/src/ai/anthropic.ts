import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Difficulty } from "@cardorize/shared";
import { db } from "../db.js";
import { decryptSecret } from "../crypto.js";
import {
  explainSystemPrompt,
  generationSystemPrompt,
  generationUserPrompt,
  gradingSystemPrompt,
} from "./prompts.js";

export const DEFAULT_MODEL = "claude-opus-4-8";

export class AiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function getProviderKey(userId: string, provider: "anthropic" | "openai"): string | null {
  const row = db
    .prepare("SELECT ciphertext FROM api_keys WHERE user_id = ? AND provider = ?")
    .get(userId, provider) as { ciphertext: string } | undefined;
  return row ? decryptSecret(row.ciphertext) : null;
}

function getClient(userId: string): Anthropic {
  const key = getProviderKey(userId, "anthropic");
  if (!key) {
    throw new AiError(
      "No Anthropic API key configured. Add one under Settings → AI Providers to enable AI features.",
      402,
    );
  }
  return new Anthropic({ apiKey: key });
}

function userModel(userId: string): string {
  const row = db.prepare("SELECT generation_model FROM settings WHERE user_id = ?").get(userId) as
    | { generation_model: string }
    | undefined;
  return row?.generation_model || DEFAULT_MODEL;
}

function friendlyApiError(err: unknown): never {
  if (err instanceof AiError) throw err;
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) throw new AiError("Your Anthropic API key was rejected. Check it in Settings.", 402);
    if (err.status === 429) throw new AiError("The AI provider rate-limited this request. Try again shortly.", 429);
    if (err.status === 404) throw new AiError("The configured model was not found. Check Settings → Model.", 400);
    throw new AiError(`AI provider error (${err.status ?? "network"}): ${err.message}`, 502);
  }
  throw new AiError(err instanceof Error ? err.message : "AI request failed", 502);
}

// ---------- Card generation ----------

const generatedDeckSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).default(""),
  sourceSummary: z.string().max(500).default(""),
  notice: z.string().max(500).nullish(),
  subsets: z.array(z.object({ name: z.string().min(1).max(120) })).max(20).default([]),
  cards: z
    .array(
      z.object({
        front: z.string().min(1).max(4000),
        back: z.string().min(1).max(8000),
        hint: z.string().max(1000).nullish(),
        tags: z.array(z.string().max(50)).max(5).default([]),
        subsetIndex: z.number().int().min(0).nullish(),
      }),
    )
    .min(1)
    .max(600),
});
export type GeneratedDeck = z.infer<typeof generatedDeckSchema>;

const CREATE_FLASHCARDS_TOOL: Anthropic.Tool = {
  name: "create_flashcards",
  description: "Record the finished flashcard deck.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      sourceSummary: { type: "string", description: "One sentence describing the source material." },
      notice: {
        type: ["string", "null"],
        description: "Set only if the source appears to be part of a larger series/playlist the user may want to study in full.",
      },
      subsets: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      },
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            front: { type: "string" },
            back: { type: "string" },
            hint: { type: ["string", "null"] },
            tags: { type: "array", items: { type: "string" } },
            subsetIndex: {
              type: ["integer", "null"],
              description: "Index into subsets, or null when there are no subsets.",
            },
          },
          required: ["front", "back"],
        },
      },
    },
    required: ["title", "cards"],
  },
};

export interface ImageInput {
  media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string; // base64
}

export async function generateCards(args: {
  userId: string;
  sourceLabel: string;
  sourceText: string;
  images?: ImageInput[];
  difficulty: Difficulty;
  cardCount: number | null;
  subsetCount: number;
  title?: string;
}): Promise<GeneratedDeck> {
  const client = getClient(args.userId);
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of args.images ?? []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  content.push({
    type: "text",
    text: generationUserPrompt({
      sourceLabel: args.sourceLabel,
      sourceText: args.sourceText || (args.images?.length ? "(see attached images)" : ""),
      difficulty: args.difficulty,
      cardCount: args.cardCount,
      subsetCount: args.subsetCount,
      title: args.title,
    }),
  });

  try {
    // Streaming keeps long generations (hundreds of cards) clear of HTTP timeouts.
    const stream = client.messages.stream({
      model: userModel(args.userId),
      max_tokens: 64000,
      system: generationSystemPrompt(),
      tools: [CREATE_FLASHCARDS_TOOL],
      tool_choice: { type: "tool", name: "create_flashcards" },
      messages: [{ role: "user", content }],
    });
    const message = await stream.finalMessage();
    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "create_flashcards",
    );
    if (!toolUse) {
      if (message.stop_reason === "refusal") throw new AiError("The AI declined to process this source.", 400);
      if (message.stop_reason === "max_tokens") {
        throw new AiError("Generation ran out of output space — try a smaller card count or split the source.", 400);
      }
      throw new AiError("The AI did not return flashcards. Please retry.", 502);
    }
    const parsed = generatedDeckSchema.safeParse(toolUse.input);
    if (!parsed.success) throw new AiError("The AI returned malformed flashcards. Please retry.", 502);
    return parsed.data;
  } catch (err) {
    friendlyApiError(err);
  }
}

// ---------- AI Mode grading ----------

const GRADE_TOOL: Anthropic.Tool = {
  name: "grade",
  description: "Record the grading verdict for the learner's answer.",
  input_schema: {
    type: "object",
    properties: {
      correct: { type: "boolean" },
      feedback: { type: "string", description: "One or two sentences of feedback for the learner." },
    },
    required: ["correct", "feedback"],
  },
};

export async function gradeAnswer(args: {
  userId: string;
  front: string;
  back: string;
  answer: string;
  strictness: number;
}): Promise<{ correct: boolean; feedback: string }> {
  const client = getClient(args.userId);
  try {
    const message = await client.messages.create({
      model: userModel(args.userId),
      max_tokens: 1024,
      system: gradingSystemPrompt(args.strictness),
      tools: [GRADE_TOOL],
      tool_choice: { type: "tool", name: "grade" },
      messages: [
        {
          role: "user",
          content: `Card front (question): ${args.front}\n\nCard back (correct answer): ${args.back}\n\nLearner's answer: ${args.answer}`,
        },
      ],
    });
    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "grade",
    );
    const parsed = z
      .object({ correct: z.boolean(), feedback: z.string().max(2000) })
      .safeParse(toolUse?.input);
    if (!parsed.success) throw new AiError("Grading failed. Please retry.", 502);
    return parsed.data;
  } catch (err) {
    friendlyApiError(err);
  }
}

// ---------- "Explain this" ----------

function explainMessages(args: { front: string; back: string; question?: string }): Anthropic.MessageParam[] {
  return [
    {
      role: "user",
      content: `Flashcard front: ${args.front}\nFlashcard back: ${args.back}\n\n${
        args.question ? `The learner asks: ${args.question}` : "Explain this card's subject matter in depth."
      }`,
    },
  ];
}

/**
 * Stream an explanation as it generates. Yields text chunks so the client can
 * render progressively — this is what keeps "Explain this" from feeling like a
 * 10-second stall on a thinking-capable model. `getClient` throws before the
 * first chunk, so a missing key is still a clean pre-stream error.
 */
export async function* explainCardStream(args: {
  userId: string;
  front: string;
  back: string;
  question?: string;
}): AsyncGenerator<string> {
  const client = getClient(args.userId);
  const stream = client.messages.stream({
    model: userModel(args.userId),
    max_tokens: 2048,
    system: explainSystemPrompt(),
    messages: explainMessages(args),
  });
  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  } catch (err) {
    friendlyApiError(err);
  }
}
