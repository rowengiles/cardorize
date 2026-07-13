import { useEffect, useState } from "react";
import type { Card } from "@cardorize/shared";
import { apiSend } from "../api";

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
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setText(null);
    setError(null);
  }, [card.id]);

  const explain = async () => {
    setOpen(true);
    if (text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiSend<{ explanation: string }>("POST", "/api/explain", { cardId: card.id });
      setText(res.explanation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load explanation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <button className="btn ghost small-btn" onClick={explain}>
          💡 Explain this
        </button>
      </div>
      {open && (
        <div className="explain-panel">
          {loading && (
            <span>
              <span className="spinner" /> Thinking…
            </span>
          )}
          {error && <span className="error-text">{error}</span>}
          {text}
        </div>
      )}
    </div>
  );
}
