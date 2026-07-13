import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FeedPost } from "@cardorize/shared";
import { apiGet, apiSend } from "../api";

export default function Feed() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    apiGet<{ posts: FeedPost[] }>("/api/feed")
      .then(({ posts }) => setPosts(posts))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // feed auto-refresh
    return () => clearInterval(t);
  }, []);

  return (
    <div className="stack" style={{ maxWidth: 680, margin: "0 auto" }}>
      <h1>Feed</h1>
      <p className="muted">
        Cards, sets, progress and achievements from the community. Cards in the feed can't be flipped —
        answer them to prove you know it.
      </p>
      {loading ? (
        <span className="spinner" />
      ) : posts.length === 0 ? (
        <p className="muted">Nothing here yet. Share a set or a card from one of your decks!</p>
      ) : (
        posts.map((p) => <Post key={p.id} post={p} onChanged={load} />)
      )}
    </div>
  );
}

function Post({ post, onChanged }: { post: FeedPost; onChanged: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ correct: boolean; feedback: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const when = new Date(post.createdAt).toLocaleString();

  const headline = () => {
    switch (post.type) {
      case "deck":
        return (
          <>
            shared the set{" "}
            <Link to={`/app/decks/${post.deckId}`}>
              <b>{post.deckTitle}</b>
            </Link>
          </>
        );
      case "card":
        return <>posted a card from <b>{post.deckTitle}</b> — can you answer it?</>;
      case "progress":
        return <>{post.detail ?? "shared progress"}</>;
      case "achievement":
        return <>{post.detail ?? "unlocked an achievement"} </>;
    }
  };

  const submitAnswer = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    try {
      const res = await apiSend<{ correct: boolean; feedback: string | null }>(
        "POST",
        `/api/posts/${post.id}/answer`,
        { answer },
      );
      setVerdict(res);
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const repost = async () => {
    try {
      await apiSend("POST", `/api/posts/${post.id}/repost`);
      setMessage("Reposted to your feed ✔");
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to repost");
    }
  };

  return (
    <div className="panel feed-post">
      <div className="head">
        <Link to={`/app/u/${post.username}`} className="who">
          @{post.username}
        </Link>
        {post.repostOf && post.repostUsername && (
          <span className="muted small">reposted @{post.repostUsername}</span>
        )}
        <span className="spacer" />
        <span className="when">{when}</span>
      </div>
      <div>{headline()}</div>

      {post.type === "card" && post.cardFront && (
        <>
          <div className="feed-card-q">{post.cardFront}</div>
          {verdict ? (
            <p className={verdict.correct ? "ok-text" : "error-text"}>
              {verdict.correct ? "✓ You answered this correctly!" : "✗ Not quite."}{" "}
              {verdict.feedback && <span className="muted">{verdict.feedback}</span>}
            </p>
          ) : (
            <div className="row">
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your answer (no flipping!)"
                style={{ flex: 1 }}
                onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
              />
              <button className="btn small-btn" onClick={submitAnswer} disabled={busy || !answer.trim()}>
                {busy ? <span className="spinner" /> : "Answer"}
              </button>
            </div>
          )}
          {post.answers.length > 0 && (
            <p className="answer-chip">
              {post.answers
                .slice(0, 5)
                .map((a) => `@${a.username} answered this ${a.correct ? "correctly ✓" : "incorrectly ✗"}`)
                .join(" · ")}
            </p>
          )}
        </>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        {post.deckId && post.type !== "card" && (
          <Link to={`/app/decks/${post.deckId}`} className="btn ghost small-btn">
            View set
          </Link>
        )}
        {post.deckId && post.type === "card" && (
          <Link to={`/app/decks/${post.deckId}`} className="btn ghost small-btn">
            See the whole set
          </Link>
        )}
        <button className="btn ghost small-btn" onClick={repost}>
          ↻ Repost
        </button>
        {message && <span className="ok-text small">{message}</span>}
      </div>
    </div>
  );
}
