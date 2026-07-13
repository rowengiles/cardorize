import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Deck } from "@cardorize/shared";
import { apiGet, apiSend } from "../api";

export default function Browse() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet<{ decks: Deck[] }>("/api/decks/public")
      .then(({ decks }) => setDecks(decks))
      .finally(() => setLoading(false));
  }, []);

  const clone = async (deckId: string) => {
    const { deck } = await apiSend<{ deck: Deck }>("POST", `/api/decks/${deckId}/clone`);
    navigate(`/app/decks/${deck.id}`);
  };

  return (
    <div className="stack">
      <h1>Browse community sets</h1>
      <p className="muted">
        Study other learners' public sets directly, or clone one into your library to make it yours.
      </p>
      {loading ? (
        <span className="spinner" />
      ) : decks.length === 0 ? (
        <p className="muted">No public sets yet — be the first: make one of your sets public.</p>
      ) : (
        <div className="grid cols-3">
          {decks.map((d) => (
            <div className="panel deck-card" key={d.id}>
              <h3>
                <Link to={`/app/decks/${d.id}`}>{d.title}</Link>
              </h3>
              <p className="muted small">{d.description || d.sourceSummary}</p>
              <div className="foot">
                <span className="badge">{d.difficulty}</span>
                <span className="badge">{d.cardCount} cards</span>
                <span className="spacer" />
                <span className="muted small">@{d.ownerName}</span>
              </div>
              <div className="row">
                <Link to={`/app/decks/${d.id}/study`} className="btn small-btn">
                  Study
                </Link>
                <button className="btn secondary small-btn" onClick={() => clone(d.id)}>
                  Clone
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
