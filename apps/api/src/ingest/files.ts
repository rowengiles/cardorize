// Uploaded-file extraction. Every path reads the temp file into memory,
// extracts, and returns — the caller deletes the temp file (retention: zero).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageInput } from "../ai/anthropic.js";

export type Extracted =
  | { kind: "text"; text: string; label: string }
  | { kind: "images"; images: ImageInput[]; label: string }
  | { kind: "audio"; label: string }; // handled by audio.ts with the raw file

const IMAGE_TYPES: Record<string, ImageInput["media_type"]> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const AUDIO_EXTS = new Set([".mp3", ".mp4", ".m4a", ".wav", ".webm", ".mpga", ".mpeg", ".ogg", ".flac"]);
const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".srt", ".vtt", ".rst", ".org", ".log"]);

export const ALLOWED_UPLOAD_EXTS = new Set([
  ".pdf",
  ".docx",
  ...TEXT_EXTS,
  ...Object.keys(IMAGE_TYPES),
  ...AUDIO_EXTS,
]);

export async function extractFromFile(filePath: string, originalName: string): Promise<Extracted> {
  const ext = path.extname(originalName).toLowerCase();
  const label = `uploaded file: ${originalName}`;

  if (ext === ".pdf") {
    const buf = await readFile(filePath);
    return { kind: "text", text: await extractPdfText(buf), label };
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return { kind: "text", text: result.value.slice(0, 400_000), label };
  }
  if (TEXT_EXTS.has(ext)) {
    const buf = await readFile(filePath);
    return { kind: "text", text: buf.toString("utf8").slice(0, 400_000), label };
  }
  if (ext in IMAGE_TYPES) {
    const buf = await readFile(filePath);
    if (buf.byteLength > 5 * 1024 * 1024) throw new Error(`${originalName}: images must be under 5 MB.`);
    return { kind: "images", images: [{ media_type: IMAGE_TYPES[ext], data: buf.toString("base64") }], label };
  }
  if (AUDIO_EXTS.has(ext)) {
    return { kind: "audio", label };
  }
  throw new Error(`Unsupported file type "${ext}". Supported: PDF, DOCX, text/markdown, images, audio/video.`);
}

async function extractPdfText(buf: Buffer): Promise<string> {
  // pdfjs-dist legacy build runs in Node without a worker or canvas for text extraction.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const parts: string[] = [];
  const maxPages = Math.min(doc.numPages, 400);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? (item as { str: string }).str : ""))
      .join(" ");
    parts.push(line);
    if (parts.join("\n").length > 400_000) break;
  }
  await doc.destroy();
  const text = parts.join("\n").replace(/[ \t]+/g, " ").trim().slice(0, 400_000);
  if (text.length < 50) {
    throw new Error("This PDF has no extractable text (likely a scan). OCR support is on the roadmap.");
  }
  return text;
}
