// Audio/video transcription via OpenAI Whisper (user's own OpenAI key).
// Kept vendor-thin: one multipart POST, no SDK.
import { readFile } from "node:fs/promises";

const WHISPER_LIMIT = 25 * 1024 * 1024;

export async function transcribeAudio(
  filePath: string,
  originalName: string,
  openaiKey: string,
): Promise<string> {
  const buf = await readFile(filePath);
  if (buf.byteLength > WHISPER_LIMIT) {
    throw new Error("Audio/video uploads are limited to 25 MB for transcription right now. Trim or compress the file.");
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)]), originalName);
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("Your OpenAI API key was rejected. Check it in Settings.");
    throw new Error(`Transcription failed (HTTP ${res.status}): ${detail.slice(0, 300)}`);
  }
  const text = (await res.text()).trim();
  if (!text) throw new Error("Transcription came back empty.");
  return text.slice(0, 400_000);
}
