// DB-backed ingestion job queue with an in-process worker.
// enqueue → extract → generate → persist deck → clean up temp file.
import { unlink } from "node:fs/promises";
import type { Difficulty } from "@cardorize/shared";
import { db, nowIso } from "../db.js";
import { newId } from "../crypto.js";
import { generateCards, getProviderKey, AiError, type ImageInput } from "../ai/anthropic.js";
import { parseYouTubeUrl, fetchYouTubeTranscript } from "./youtube.js";
import { fetchArticle } from "./article.js";
import { extractFromFile } from "./files.js";
import { transcribeAudio } from "./audio.js";

export interface JobPayload {
  source:
    | { kind: "url"; url: string }
    | { kind: "text"; text: string; label?: string }
    | { kind: "file"; filePath: string; originalName: string };
  options: {
    title?: string;
    difficulty: Difficulty;
    cardCount: number | null;
    subsetCount: number;
    isPublic: boolean;
  };
}

const MAX_ACTIVE_JOBS_PER_USER = 3;

export function enqueueJob(userId: string, payload: JobPayload): { jobId: string } {
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status IN ('queued','running')")
    .get(userId) as { n: number };
  if (active.n >= MAX_ACTIVE_JOBS_PER_USER) {
    throw new AiError("You already have several sets generating. Wait for one to finish.", 429);
  }
  const jobId = newId();
  db.prepare(
    "INSERT INTO jobs (id, user_id, status, step, payload, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run(jobId, userId, "queued", "Queued", JSON.stringify(payload), nowIso(), nowIso());
  setImmediate(() => runJob(jobId, userId, payload).catch(() => {}));
  return { jobId };
}

function setJob(jobId: string, fields: Record<string, string | null>) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
    ...keys.map((k) => fields[k]),
    nowIso(),
    jobId,
  );
}

async function runJob(jobId: string, userId: string, payload: JobPayload) {
  const tempFile = payload.source.kind === "file" ? payload.source.filePath : null;
  try {
    setJob(jobId, { status: "running", step: "Reading source" });

    let sourceLabel = "";
    let sourceText = "";
    let images: ImageInput[] | undefined;
    let extractNotice: string | null = null;
    let titleGuess: string | undefined;

    const src = payload.source;
    if (src.kind === "url") {
      const yt = parseYouTubeUrl(src.url);
      if (yt) {
        setJob(jobId, { step: "Fetching YouTube transcript" });
        const t = await fetchYouTubeTranscript(yt.videoId);
        sourceLabel = `YouTube video "${t.title}"${t.channel ? ` by ${t.channel}` : ""}`;
        sourceText = t.transcript;
        titleGuess = t.title;
        if (yt.playlistId) {
          extractNotice =
            "This video is part of a playlist — it may be one chapter of a larger series. Full-playlist ingestion is coming; for now, add the other videos as separate sources.";
        }
      } else {
        setJob(jobId, { step: "Fetching article" });
        const a = await fetchArticle(src.url);
        sourceLabel = `web page "${a.title}" (${src.url})`;
        sourceText = a.text;
        titleGuess = a.title;
      }
    } else if (src.kind === "text") {
      sourceLabel = src.label ?? "pasted text";
      sourceText = src.text;
    } else {
      setJob(jobId, { step: "Reading file" });
      const extracted = await extractFromFile(src.filePath, src.originalName);
      sourceLabel = extracted.label;
      if (extracted.kind === "text") {
        sourceText = extracted.text;
      } else if (extracted.kind === "images") {
        images = extracted.images;
      } else {
        const openaiKey = getProviderKey(userId, "openai");
        if (!openaiKey) {
          throw new AiError(
            "Audio/video sources need an OpenAI API key (for Whisper transcription). Add one under Settings → AI Providers.",
            402,
          );
        }
        setJob(jobId, { step: "Transcribing audio" });
        sourceText = await transcribeAudio(src.filePath, src.originalName, openaiKey);
      }
    }

    if (!sourceText.trim() && !images?.length) {
      throw new Error("No usable content could be extracted from this source.");
    }

    setJob(jobId, { step: "Generating flashcards with AI" });
    const generated = await generateCards({
      userId,
      sourceLabel,
      sourceText,
      images,
      difficulty: payload.options.difficulty,
      cardCount: payload.options.cardCount,
      subsetCount: payload.options.subsetCount,
      title: payload.options.title ?? titleGuess,
    });

    setJob(jobId, { step: "Saving deck" });
    const deckId = persistDeck(userId, payload, generated, sourceLabel);

    const notices = [extractNotice, generated.notice].filter(Boolean).join(" ");
    setJob(jobId, { status: "done", step: "Done", deck_id: deckId, notice: notices || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    setJob(jobId, { status: "failed", step: null, error: message });
  } finally {
    if (tempFile) await unlink(tempFile).catch(() => {});
  }
}

function persistDeck(
  userId: string,
  payload: JobPayload,
  generated: Awaited<ReturnType<typeof generateCards>>,
  sourceLabel: string,
): string {
  const deckId = newId();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO decks (id, owner_id, title, description, difficulty, is_public, source_summary, created_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      deckId,
      userId,
      (payload.options.title ?? generated.title).slice(0, 200),
      generated.description,
      payload.options.difficulty,
      payload.options.isPublic ? 1 : 0,
      generated.sourceSummary || sourceLabel,
      nowIso(),
    );
    const subsetIds: string[] = [];
    const insertSubset = db.prepare("INSERT INTO subsets (id, deck_id, name, position) VALUES (?,?,?,?)");
    generated.subsets.forEach((s, i) => {
      const sid = newId();
      subsetIds.push(sid);
      insertSubset.run(sid, deckId, s.name, i);
    });
    const insertCard = db.prepare(
      "INSERT INTO cards (id, deck_id, subset_id, position, front, back, hint, tags) VALUES (?,?,?,?,?,?,?,?)",
    );
    generated.cards.forEach((c, i) => {
      const subsetId =
        c.subsetIndex != null && c.subsetIndex >= 0 && c.subsetIndex < subsetIds.length
          ? subsetIds[c.subsetIndex]
          : null;
      insertCard.run(newId(), deckId, subsetId, i, c.front, c.back, c.hint ?? null, JSON.stringify(c.tags ?? []));
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return deckId;
}
