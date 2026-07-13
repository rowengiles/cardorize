import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Deck, FeedPost } from "@cardorize/shared";
import { apiGet } from "../api";

interface ProfileData {
  user: { username: string; createdAt: string };
  decks: Deck[];
  achievements: FeedPost[];
}

export default function Profile() {
  const { username } = useParams<{ username: string }>();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiGet<ProfileData>(`/api/users/${username}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [username]);

  if (error) return <p className="error-text">{error}</p>;
  if (!data) return <span className="spinner" />;

  return (
    <div className="stack">
      <h1>@{data.user.username}</h1>
      <p className="muted">Learning since {new Date(data.user.createdAt).toLocaleDateString()}</p>

      {data.achievements.length > 0 && (
        <div className="panel">
          <h3>Achievements & progress</h3>
          {data.achievements.map((a) => (
            <div className="job-row" key={a.id}>
              <span>
                {a.type === "achievement" ? "🏆" : "📈"} @{data.user.username} {a.detail}
              </span>
              <span className="spacer" />
              <span className="muted small">{new Date(a.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      <h2>Sets</h2>
      {data.decks.length === 0 ? (
        <p className="muted">No public sets.</p>
      ) : (
        <div className="grid cols-3">
          {data.decks.map((d) => (
            <Link to={`/app/decks/${d.id}`} key={d.id} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="panel deck-card">
                <h3>{d.title}</h3>
                <p className="muted small">{d.description || d.sourceSummary}</p>
                <div className="foot">
                  <span className="badge">{d.difficulty}</span>
                  <span className="badge">{d.cardCount} cards</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
