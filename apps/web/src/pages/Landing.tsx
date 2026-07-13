import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <span className="logo">
            Card<b>orize</b>
          </span>
          <span className="spacer" />
          <Link to="/auth" className="btn small-btn">
            Sign in / Register
          </Link>
        </div>
      </nav>

      <div className="hero container">
        <h1>
          Any source. <span className="accent">Instant flashcards.</span>
          <br />
          Lasting knowledge.
        </h1>
        <p className="sub">
          Paste a YouTube link, an article, a whitepaper — or drop in a PDF, a lecture recording, even
          screenshots. Cardorize's AI turns it into study-ready flashcards and helps you master them with
          spaced repetition and active recall.
        </p>
        <Link to="/auth" className="btn big">
          Start learning free →
        </Link>
      </div>

      <div className="container">
        <div className="steps">
          <div className="step panel">
            <span className="num">1</span>
            <h3>Add any source</h3>
            <p>Paste a link or upload a file. Drop in whatever you're learning from.</p>
            <p className="examples">
              YouTube · articles · whitepapers · wikis · PDFs · audio · video · lecture notes · screenshots
            </p>
          </div>
          <div className="step panel">
            <span className="num">2</span>
            <h3>Get instant flashcards</h3>
            <p>AI pulls out what matters and builds study-ready cards.</p>
            <p className="examples">Key ideas become Q&amp;A cards in seconds — not hours of typing.</p>
          </div>
          <div className="step panel">
            <span className="num">3</span>
            <h3>Study for lasting knowledge</h3>
            <p>Review with spaced repetition and active recall so it actually sticks.</p>
            <p className="examples">Practice at the right moment. Remember for the long term.</p>
          </div>
        </div>

        <div className="panel" style={{ textAlign: "center", marginBottom: 40 }}>
          <h2>Three ways to master a set</h2>
          <div className="mode-chips">
            <span className="badge accent">Memory Mode — sequential recall</span>
            <span className="badge accent">Ladder Mode — 5-stage Leitner system</span>
            <span className="badge accent">AI Mode — the AI grades your answers</span>
          </div>
          <p className="muted" style={{ marginTop: 14 }}>
            Progress saves automatically — pick up exactly where you left off. Share sets, answer cards on
            friends' feeds, and build a public record of what you've mastered.
          </p>
        </div>

        <footer className="muted small" style={{ textAlign: "center", padding: "20px 0 60px" }}>
          Cardorize · Any source. Instant flashcards. Lasting knowledge.
        </footer>
      </div>
    </>
  );
}
