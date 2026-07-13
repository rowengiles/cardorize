import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Deck } from "@cardorize/shared";
import { apiGet, apiSend } from "../api";
import { useAuth } from "../state";

export default function DeckDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    apiGet<{ deck: Deck }>(`/api/decks/${id}`)
      .then(({ deck }) => setDeck(deck))
      .catch((e) => setError(e.message));
  };
  useEffect(load, [id]);

  if (error) return <p className="error-text">{error}</p>;
  if (!deck) return <span className="spinner" />;

  const isOwner = deck.ownerId === user?.id;
  const cards = deck.cards ?? [];
  const subsets = deck.subsets ?? [];

  const share = async (type: "deck" | "progress" | "achievement") => {
    setMessage(null);
    try {
      await apiSend("POST", "/api/posts", { type, deckId: deck.id });
      setMessage("Posted to your feed ✔");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to post");
    }
  };

  const shareCard = async (cardId: string) => {
    setMessage(null);
    try {
      await apiSend("POST", "/api/posts", { type: "card", cardId });
      setMessage("Card posted to your feed ✔ (feed viewers answer it — they can't flip it)");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to post");
    }
  };

  const clone = async () => {
    const { deck: cloned } = await apiSend<{ deck: Deck }>("POST", `/api/decks/${deck.id}/clone`);
    navigate(`/app/decks/${cloned.id}`);
  };

  const togglePublic = async () => {
    const { deck: updated } = await apiSend<{ deck: Deck }>("PATCH", `/api/decks/${deck.id}`, {
      isPublic: !deck.isPublic,
    });
    setDeck({ ...deck, isPublic: updated.isPublic });
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${deck.title}" and all its cards? This cannot be undone.`)) return;
    await apiSend("DELETE", `/api/decks/${deck.id}`);
    navigate("/app");
  };

  return (
    <div className="stack">
      {notice && (
        <div className="panel" style={{ borderColor: "var(--accent)" }}>
          💡 {notice}
        </div>
      )}
      <div className="row">
        <div>
          <h1>{deck.title}</h1>
          <p className="muted">{deck.description}</p>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="badge">{deck.difficulty}</span>
            <span className="badge">{cards.length} cards</span>
            {subsets.length > 0 && <span className="badge">{subsets.length} subsets</span>}
            <span className="badge">{deck.isPublic ? "public" : "private"}</span>
            {!isOwner && <span className="badge accent">by @{deck.ownerName}</span>}
          </div>
        </div>
        <span className="spacer" />
        <Link to={`/app/decks/${deck.id}/study`} className="btn big">
          Study →
        </Link>
      </div>

      <div className="row">
        {isOwner && (
          <>
            <button className="btn secondary small-btn" onClick={() => share("deck")}>
              Share set to feed
            </button>
            <button className="btn secondary small-btn" onClick={() => share("progress")}>
              Share progress
            </button>
            <button className="btn secondary small-btn" onClick={() => share("achievement")}>
              Post mastery 🏆
            </button>
            <button className="btn ghost small-btn" onClick={togglePublic}>
              Make {deck.isPublic ? "private" : "public"}
            </button>
            <button className="btn danger small-btn" onClick={remove}>
              Delete
            </button>
          </>
        )}
        {!isOwner && (
          <button className="btn secondary small-btn" onClick={clone}>
            Clone into my sets
          </button>
        )}
      </div>
      {message && <p className="ok-text">{message}</p>}

      {subsets.length > 0 && (
        <div className="panel">
          <h3>Subsets</h3>
          <div className="row">
            {subsets.map((s) => (
              <Link key={s.id} to={`/app/decks/${deck.id}/study?subset=${s.id}`} className="btn ghost small-btn">
                {s.name} ({cards.filter((c) => c.subsetId === s.id).length})
              </Link>
            ))}
          </div>
          <p className="muted small">Study one subset at a time, or the whole set from the Study button.</p>
        </div>
      )}

      <div className="panel">
        <h3>Cards</h3>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "45%" }}>Front</th>
              <th>Back</th>
              {isOwner && <th style={{ width: 90 }} />}
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}>
                <td>{c.front}</td>
                <td className="muted">{c.back.length > 160 ? `${c.back.slice(0, 160)}…` : c.back}</td>
                {isOwner && (
                  <td>
                    <button className="btn ghost small-btn" onClick={() => shareCard(c.id)}>
                      Post
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
