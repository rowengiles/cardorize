import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Deck, Job } from "@cardorize/shared";
import { apiGet } from "../api";
import { useAuth } from "../state";

export default function Dashboard() {
  const { user, settings } = useAuth();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([apiGet<{ decks: Deck[] }>("/api/decks"), apiGet<{ jobs: Job[] }>("/api/jobs")])
      .then(([d, j]) => {
        setDecks(d.decks);
        setJobs(j.jobs);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Poll while any job is active so freshly generated decks appear.
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [active]);

  const noAiKey = settings && !settings.providers.includes("anthropic");

  return (
    <div className="stack">
      <div className="row">
        <h1>Welcome back, {user?.username}</h1>
        <span className="spacer" />
        <Link to="/app/create" className="btn">
          + New set from any source
        </Link>
      </div>

      {noAiKey && (
        <div className="panel" style={{ borderColor: "var(--warn)" }}>
          <b>Add your AI key to unlock generation.</b>{" "}
          <span className="muted">
            Cardorize is bring-your-own-key: add an Anthropic API key in{" "}
            <Link to="/app/settings">Settings</Link> to generate flashcards from links and files, use AI
            Mode, and get "Explain this" deep dives. Your starter deck below works without one.
          </span>
        </div>
      )}

      {jobs.filter((j) => j.status !== "done").length > 0 && (
        <div className="panel">
          <h3>Generation jobs</h3>
          {jobs
            .filter((j) => j.status !== "done")
            .slice(0, 5)
            .map((j) => (
              <div className="job-row" key={j.id}>
                {(j.status === "running" || j.status === "queued") && <span className="spinner" />}
                <span className={j.status === "failed" ? "error-text" : ""}>
                  {j.status === "failed" ? `Failed: ${j.error}` : (j.step ?? j.status)}
                </span>
              </div>
            ))}
        </div>
      )}

      <h2 style={{ marginTop: 8 }}>Your sets</h2>
      {loading ? (
        <span className="spinner" />
      ) : decks.length === 0 ? (
        <p className="muted">No sets yet — create your first from a link or file.</p>
      ) : (
        <div className="grid cols-3">
          {decks.map((d) => (
            <Link to={`/app/decks/${d.id}`} key={d.id} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="panel deck-card">
                <h3>{d.title}</h3>
                <p className="muted small">{d.description || d.sourceSummary}</p>
                <div className="foot">
                  <span className="badge">{d.difficulty}</span>
                  <span className="badge">{d.cardCount} cards</span>
                  {d.isPublic && <span className="badge accent">public</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
