// YouTube transcript extraction via the public watch page's caption tracks.
// Best-effort: YouTube can change internals or block datacenter IPs; errors
// surface as actionable job failures.
import { safeFetchText } from "./safefetch.js";

export function parseYouTubeUrl(raw: string): { videoId: string; playlistId: string | null } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let videoId: string | null = null;
  if (host === "youtu.be") videoId = url.pathname.slice(1).split("/")[0] || null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/") || url.pathname.startsWith("/live/")) {
      videoId = url.pathname.split("/")[2] || null;
    }
  }
  if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) return null;
  return { videoId, playlistId: url.searchParams.get("list") };
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

export async function fetchYouTubeTranscript(
  videoId: string,
): Promise<{ title: string; transcript: string; channel: string | null }> {
  const watch = await safeFetchText(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    accept: "text/html",
  });

  const playerJson = extractPlayerResponse(watch.text);
  if (!playerJson) throw new Error("Could not read the YouTube page (it may be region-blocked or removed).");

  const title: string = playerJson?.videoDetails?.title ?? "YouTube video";
  const channel: string | null = playerJson?.videoDetails?.author ?? null;
  const tracks: CaptionTrack[] =
    playerJson?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) {
    // Distinguish a YouTube bot/login wall from a genuinely caption-less video —
    // the fix differs, and blaming "no transcript" when YouTube blocked us is wrong.
    const status: string | undefined = playerJson?.playabilityStatus?.status;
    if (status && status !== "OK") {
      throw new Error(
        `YouTube blocked this transcript request (status: ${status}). YouTube rate-limits automated fetches — this does not necessarily mean the video lacks a transcript. Workaround: download the video and upload it as an .mp3/.mp4; with your Whisper (OpenAI) key it will be transcribed directly.`,
      );
    }
    throw new Error(
      "This video exposes no captions to read. If it has spoken audio, download it and upload the .mp3/.mp4 — with your Whisper (OpenAI) key it will be transcribed directly.",
    );
  }
  // Prefer manual English, then any manual, then auto-generated.
  const track =
    tracks.find((t) => t.languageCode?.startsWith("en") && t.kind !== "asr") ??
    tracks.find((t) => t.kind !== "asr") ??
    tracks[0];

  const sep = track.baseUrl.includes("?") ? "&" : "?";
  const captions = await safeFetchText(`${track.baseUrl}${sep}fmt=json3`, { accept: "*/*" });
  const transcript = parseJson3(captions.text);
  if (!transcript.trim()) throw new Error("The video's transcript came back empty.");
  return { title, transcript, channel };
}

function extractPlayerResponse(html: string): any | null {
  const marker = "ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = start + marker.length;
  // Balance braces to find the end of the JSON object.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseJson3(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const parts: string[] = [];
    for (const event of data.events ?? []) {
      for (const seg of event.segs ?? []) {
        if (seg.utf8) parts.push(seg.utf8);
      }
    }
    return parts.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
  } catch {
    return "";
  }
}
