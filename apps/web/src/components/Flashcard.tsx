import { useEffect, useState } from "react";
import type { Card } from "@cardorize/shared";
import { Markdown } from "./Markdown";

export function FlipCard({
  card,
  flippable = true,
  onFlipped,
}: {
  card: Card;
  flippable?: boolean;
  onFlipped?: (flipped: boolean) => void;
}) {
  const [flipped, setFlipped] = useState(false);

  // Reset flip whenever the card changes.
  useEffect(() => setFlipped(false), [card.id]);

  const toggle = () => {
    if (!flippable) return;
    setFlipped((f) => {
      onFlipped?.(!f);
      return !f;
    });
  };

  return (
    <div className="flip-scene">
      <div
        className={`flip-card${flipped ? " flipped" : ""}`}
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
        aria-label={flipped ? "Card back — click to see front" : "Card front — click to flip"}
      >
        <div className="flip-face front">
          <span className="face-label">Front</span>
          <div className="content">{card.front}</div>
          {card.hint && <div className="hint">Hint: {card.hint}</div>}
          {flippable && <div className="hint">click to flip</div>}
        </div>
        <div className="flip-face back">
          <span className="face-label">Back</span>
          <div className="content">{card.back}</div>
        </div>
      </div>
    </div>
  );
}

export function ExplainButton({ card }: { card: Card }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setText("");
    setError(null);
  }, [card.id]);

  const explain = async () => {
    setOpen(true);
    if (text || loading) return;
    setLoading(true);
    setError(null);
    setText("");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: card.id }),
      });
      if (!res.ok || !res.body) {
        let msg = `Request failed (${res.status})`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }
      // Stream tokens in as they arrive so the panel fills immediately.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setText(acc);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load explanation");
    } finally {
      setLoading(false);
    }
  };

  const streaming = loading && text.length > 0;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <button className="btn ghost small-btn" onClick={explain}>
          💡 Explain this
        </button>
      </div>
      {open && (
        <div className="explain-panel">
          {loading && text.length === 0 && (
            <span>
              <span className="spinner" /> Thinking…
            </span>
          )}
          {error && <span className="error-text">{error}</span>}
          {text && <Markdown text={text} />}
          {streaming && <span className="stream-caret" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
