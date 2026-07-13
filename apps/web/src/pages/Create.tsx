import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { DIFFICULTIES, type Difficulty, type Job } from "@cardorize/shared";
import { apiGet, apiSend, apiUpload } from "../api";
import { useAuth } from "../state";

type SourceKind = "url" | "upload" | "text";

export default function Create() {
  const { settings } = useAuth();
  const navigate = useNavigate();
  const [kind, setKind] = useState<SourceKind>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [cardCount, setCardCount] = useState<string>("");
  const [subsetCount, setSubsetCount] = useState<string>("0");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => () => clearInterval(pollRef.current), []);

  const startPolling = (jobId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const { job } = await apiGet<{ job: Job }>(`/api/jobs/${jobId}`);
        setJob(job);
        if (job.status === "done" && job.deckId) {
          clearInterval(pollRef.current);
          navigate(`/app/decks/${job.deckId}`, { state: { notice: job.notice } });
        }
        if (job.status === "failed") clearInterval(pollRef.current);
      } catch {
        /* transient poll error — keep trying */
      }
    }, 2000);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setJob(null);
    const options = {
      title: title.trim() || undefined,
      difficulty: (difficulty || undefined) as Difficulty | undefined,
      cardCount: cardCount ? Number(cardCount) : null,
      subsetCount: subsetCount ? Number(subsetCount) : 0,
      isPublic,
    };
    try {
      let res: { jobId: string };
      if (kind === "upload") {
        if (!file) throw new Error("Choose a file first");
        res = await apiUpload<{ jobId: string }>("/api/sources/upload", file, {
          options: JSON.stringify(options),
        });
      } else {
        res = await apiSend<{ jobId: string }>("POST", "/api/sources", {
          kind: kind === "url" ? "url" : "text",
          url: kind === "url" ? url.trim() : undefined,
          text: kind === "text" ? text : undefined,
          options,
        });
      }
      setJob({ id: res.jobId, status: "queued", step: "Queued", deckId: null, error: null, notice: null, createdAt: "" });
      startPolling(res.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start generation");
    }
  };

  const busy = job !== null && (job.status === "queued" || job.status === "running");

  return (
    <div className="stack" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>Create a set from any source</h1>
      <p className="muted">
        Paste a YouTube link or article URL, upload a document / audio / screenshots, or paste raw text —
        the AI reads it and builds your flashcards.
      </p>

      <div className="mode-tabs" style={{ alignSelf: "flex-start" }}>
        {(
          [
            ["url", "Link"],
            ["upload", "Upload"],
            ["text", "Paste text"],
          ] as [SourceKind, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="panel">
        {kind === "url" && (
          <div className="field">
            <label>Source URL — YouTube video, article, whitepaper, wiki…</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              type="url"
              required
            />
          </div>
        )}
        {kind === "upload" && (
          <div className="field">
            <label>File — PDF, DOCX, TXT/MD, image (PNG/JPG), or audio/video (MP3/MP4, ≤25 MB)</label>
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.json,.srt,.vtt,.png,.jpg,.jpeg,.webp,.gif,.mp3,.mp4,.m4a,.wav,.ogg,.flac,.webm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
            <p className="muted small">
              Files are read, converted to flashcards, then deleted — Cardorize never stores your uploads.
            </p>
          </div>
        )}
        {kind === "text" && (
          <div className="field">
            <label>Paste the material to memorize</label>
            <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} required />
          </div>
        )}

        <div className="row">
          <div className="field" style={{ flex: 2, minWidth: 180 }}>
            <label>Deck title (optional — AI will choose one)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Difficulty</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}>
              <option value="">Default ({settings?.defaultDifficulty ?? "intermediate"})</option>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Card count (blank = AI decides)</label>
            <input
              type="number"
              min={4}
              max={500}
              value={cardCount}
              onChange={(e) => setCardCount(e.target.value)}
              placeholder="e.g. 50"
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Subsets (0 = none)</label>
            <input
              type="number"
              min={0}
              max={20}
              value={subsetCount}
              onChange={(e) => setSubsetCount(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Visibility</label>
            <select value={isPublic ? "public" : "private"} onChange={(e) => setIsPublic(e.target.value === "public")}>
              <option value="private">Private</option>
              <option value="public">Public (shareable)</option>
            </select>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        {job?.status === "failed" && <p className="error-text">Generation failed: {job.error}</p>}
        {busy && (
          <p>
            <span className="spinner" /> {job?.step ?? "Working"}… this can take a minute for large sources.
          </p>
        )}
        <button className="btn big" disabled={busy} style={{ marginTop: 6 }}>
          Generate flashcards
        </button>
      </form>

      <div className="panel muted small">
        <b>Coming soon:</b> combining multiple sources in one set, full YouTube playlists, X threads with
        video, meeting connectors (Zoom / Meet / Teams), and live lecture capture. Scanned-PDF OCR is on the
        roadmap — text-based PDFs work today.
      </div>
    </div>
  );
}
