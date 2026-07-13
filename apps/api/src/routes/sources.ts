import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { generationOptionsSchema, sourceCreateSchema, type Difficulty } from "@cardorize/shared";
import { db } from "../db.js";
import { newId } from "../crypto.js";
import { requireAuth } from "../auth.js";
import { rateLimit } from "../ratelimit.js";
import { enqueueJob, type JobPayload } from "../ingest/pipeline.js";
import { ALLOWED_UPLOAD_EXTS } from "../ingest/files.js";
import { AiError } from "../ai/anthropic.js";

function resolveDifficulty(userId: string, requested?: Difficulty): Difficulty {
  if (requested) return requested;
  const row = db.prepare("SELECT default_difficulty FROM settings WHERE user_id = ?").get(userId) as
    | { default_difficulty: Difficulty }
    | undefined;
  return row?.default_difficulty ?? "intermediate";
}

function jobDto(row: any) {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    deckId: row.deck_id,
    error: row.error,
    notice: row.notice,
    createdAt: row.created_at,
  };
}

export function registerSourceRoutes(app: FastifyInstance) {
  const genLimiter = rateLimit("generate", 6, 0.05); // 6 burst, ~3/minute sustained

  app.post("/api/sources", { preHandler: [requireAuth, genLimiter] }, async (req, reply) => {
    const body = sourceCreateSchema.parse(req.body);
    if (body.kind === "url" && !body.url) return reply.code(400).send({ error: "url is required" });
    if (body.kind === "text" && !body.text?.trim()) return reply.code(400).send({ error: "text is required" });

    const payload: JobPayload = {
      source:
        body.kind === "url"
          ? { kind: "url", url: body.url! }
          : { kind: "text", text: body.text! },
      options: {
        title: body.options.title,
        difficulty: resolveDifficulty(req.userId!, body.options.difficulty),
        cardCount: body.options.cardCount ?? null,
        subsetCount: body.options.subsetCount,
        isPublic: body.options.isPublic,
      },
    };
    try {
      return enqueueJob(req.userId!, payload);
    } catch (err) {
      if (err instanceof AiError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.post("/api/sources/upload", { preHandler: [requireAuth, genLimiter] }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file uploaded" });

    const ext = path.extname(file.filename || "").toLowerCase();
    if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
      return reply.code(400).send({ error: `Unsupported file type "${ext || "unknown"}"` });
    }

    // Options ride along as a multipart field named "options" (JSON).
    const rawOptions = (file.fields?.options as { value?: string } | undefined)?.value;
    let options;
    try {
      options = generationOptionsSchema.parse(rawOptions ? JSON.parse(rawOptions) : {});
    } catch {
      return reply.code(400).send({ error: "Invalid options" });
    }

    const tempDir = path.join(tmpdir(), "cardorize-uploads");
    await mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `${newId()}${ext}`);
    await pipeline(file.file, createWriteStream(tempPath));
    if (file.file.truncated) {
      return reply.code(413).send({ error: "File exceeds the 50 MB upload limit" });
    }

    const payload: JobPayload = {
      source: { kind: "file", filePath: tempPath, originalName: path.basename(file.filename) },
      options: {
        title: options.title,
        difficulty: resolveDifficulty(req.userId!, options.difficulty),
        cardCount: options.cardCount ?? null,
        subsetCount: options.subsetCount,
        isPublic: options.isPublic,
      },
    };
    try {
      return enqueueJob(req.userId!, payload);
    } catch (err) {
      if (err instanceof AiError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/jobs/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, req.userId!);
    if (!row) return reply.code(404).send({ error: "Job not found" });
    return { job: jobDto(row) };
  });

  app.get("/api/jobs", { preHandler: requireAuth }, async (req) => {
    const rows = db
      .prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
      .all(req.userId!);
    return { jobs: rows.map(jobDto) };
  });
}
