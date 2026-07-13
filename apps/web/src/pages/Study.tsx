import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  MODE_LABELS,
  STUDY_MODES,
  initAiMode,
  initLadder,
  initMemory,
  ladderAnswer,
  ladderCurrentCard,
  ladderProgressPct,
  ladderStageCounts,
  type AiModeState,
  type AnyStudyState,
  type Card,
  type Deck,
  type LadderState,
  type MemoryState,
  type StudyMode,
} from "@cardorize/shared";
import { apiGet, apiSend } from "../api";
import { ExplainButton, FlipCard } from "../components/Flashcard";
import { Markdown } from "../components/Markdown";
import { useAuth } from "../state";

/** Server blob per (deck, mode): one state per scope ("all" or a subsetId). */
type ScopedStates = { scopes: Record<string, AnyStudyState> };

export default function Study() {
  const { id: deckId } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const scope = params.get("subset") ?? "all";
  const mode = (params.get("mode") ?? "memory") as StudyMode;
  const { settings } = useAuth();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [blobs, setBlobs] = useState<Record<StudyMode, ScopedStates> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shuffle, setShuffle] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    Promise.all([
      apiGet<{ deck: Deck }>(`/api/decks/${deckId}`),
      ...STUDY_MODES.map((m) => apiGet<{ state: ScopedStates | null }>(`/api/study/${deckId}/${m}`)),
    ])
      .then(([d, ...states]) => {
        setDeck((d as { deck: Deck }).deck);
        const loaded = {} as Record<StudyMode, ScopedStates>;
        STUDY_MODES.forEach((m, i) => {
          const s = (states[i] as { state: ScopedStates | null }).state;
          loaded[m] = s && typeof s === "object" && "scopes" in s ? s : { scopes: {} };
        });
        setBlobs(loaded);
      })
      .catch((e) => setError(e.message));
  }, [deckId]);

  const cards: Card[] = useMemo(() => {
    const all = deck?.cards ?? [];
    return scope === "all" ? all : all.filter((c) => c.subsetId === scope);
  }, [deck, scope]);

  const cardIds = useMemo(() => cards.map((c) => c.id), [cards]);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  if (error) return <p className="error-text">{error}</p>;
  if (!deck || !blobs) return <span className="spinner" />;
  if (cards.length === 0) return <p className="muted">This set has no cards to study.</p>;

  const persist = (m: StudyMode, next: ScopedStates) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiSend("PUT", `/api/study/${deckId}/${m}`, { state: next }).catch(() => {});
    }, 400);
  };

  const stateMatchesCards = (s: AnyStudyState | undefined): boolean => {
    if (!s) return false;
    const ids = s.mode === "ladder" ? Object.keys(s.stages) : s.order;
    if (ids.length !== cardIds.length) return false;
    const set = new Set(cardIds);
    return ids.every((i) => set.has(i));
  };

  const getState = (m: StudyMode): AnyStudyState => {
    const existing = blobs[m].scopes[scope];
    if (stateMatchesCards(existing)) return existing!;
    const fresh: AnyStudyState =
      m === "memory" ? initMemory(cardIds, shuffle) : m === "ladder" ? initLadder(cardIds, shuffle) : initAiMode(cardIds, shuffle);
    return fresh;
  };

  const setState = (m: StudyMode, s: AnyStudyState) => {
    const next: Record<StudyMode, ScopedStates> = {
      ...blobs,
      [m]: { scopes: { ...blobs[m].scopes, [scope]: s } },
    };
    setBlobs(next);
    persist(m, next[m]);
  };

  const restart = () => {
    const m = mode;
    const fresh =
      m === "memory" ? initMemory(cardIds, shuffle) : m === "ladder" ? initLadder(cardIds, shuffle) : initAiMode(cardIds, shuffle);
    setState(m, fresh);
  };

  const setMode = (m: StudyMode) => {
    params.set("mode", m);
    setParams(params, { replace: true });
  };

  const subsetName =
    scope === "all" ? null : (deck.subsets?.find((s) => s.id === scope)?.name ?? "subset");

  const state = getState(mode);

  return (
    <div className="stack">
      <div className="study-header">
        <Link to={`/app/decks/${deckId}`} className="muted">
          ← {deck.title}
        </Link>
        {subsetName && <span className="badge accent">Subset: {subsetName}</span>}
        <span className="spacer" />
        <div className="mode-tabs">
          {STUDY_MODES.map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <label className="row small muted" style={{ marginBottom: 0, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={shuffle}
            onChange={(e) => setShuffle(e.target.checked)}
            style={{ width: "auto" }}
          />
          shuffle on restart
        </label>
        <button className="btn ghost small-btn" onClick={restart}>
          Restart
        </button>
      </div>

      {mode === "memory" && (
        <MemoryStudy state={state as MemoryState} cardById={cardById} onChange={(s) => setState("memory", s)} />
      )}
      {mode === "ladder" && (
        <LadderStudy
          state={state as LadderState}
          cardById={cardById}
          deckId={deckId!}
          deckTitle={deck.title}
          onChange={(s) => setState("ladder", s)}
        />
      )}
      {mode === "ai" && (
        <AiStudy
          state={state as AiModeState}
          cardById={cardById}
          deckId={deckId!}
          defaultStrictness={settings?.aiStrictness ?? 3}
          onChange={(s) => setState("ai", s)}
        />
      )}
    </div>
  );
}

// ---------- Memory Mode: strict sequential recall ----------

function MemoryStudy({
  state,
  cardById,
  onChange,
}: {
  state: MemoryState;
  cardById: Map<string, Card>;
  onChange: (s: MemoryState) => void;
}) {
  const card = cardById.get(state.order[state.index]);
  if (!card) return null;
  const pct = Math.round(((state.index + 1) / state.order.length) * 100);

  const go = (delta: number) => {
    const index = Math.min(Math.max(state.index + delta, 0), state.order.length - 1);
    onChange({ ...state, index });
  };

  return (
    <div className="stack">
      <div className="row">
        <span className="muted small">
          Card {state.index + 1} of {state.order.length}
        </span>
        <div className="progress-track" style={{ flex: 1 }}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <FlipCard card={card} />
      <div className="answer-buttons">
        <button className="btn secondary" onClick={() => go(-1)} disabled={state.index === 0}>
          ← Previous
        </button>
        <button className="btn" onClick={() => go(1)} disabled={state.index === state.order.length - 1}>
          Next →
        </button>
      </div>
      <ExplainButton card={card} />
    </div>
  );
}

// ---------- Ladder Mode: Leitner 5-stage progression ----------

function LadderStudy({
  state,
  cardById,
  deckId,
  deckTitle,
  onChange,
}: {
  state: LadderState;
  cardById: Map<string, Card>;
  deckId: string;
  deckTitle: string;
  onChange: (s: LadderState) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const currentId = ladderCurrentCard(state);
  const card = currentId ? cardById.get(currentId) : null;
  const counts = ladderStageCounts(state);

  useEffect(() => setFlipped(false), [currentId]);

  if (state.completed) {
    return (
      <div className="panel study-done">
        <div className="big-emoji">🏆</div>
        <h2>Set mastered!</h2>
        <p className="muted">
          Every card climbed all 5 stages of "{deckTitle}". Start over, try another mode, or post it.
        </p>
        <div className="answer-buttons">
          <button
            className="btn"
            onClick={async () => {
              try {
                await apiSend("POST", "/api/posts", { type: "achievement", deckId });
                setPosted("Achievement posted to your feed 🎉");
              } catch (e) {
                setPosted(e instanceof Error ? e.message : "Could not post");
              }
            }}
          >
            Post achievement to feed
          </button>
        </div>
        {posted && <p className="ok-text">{posted}</p>}
      </div>
    );
  }
  if (!card) return null;

  const answer = (correct: boolean) => {
    setFlipped(false);
    onChange(ladderAnswer(state, card.id, correct));
  };

  return (
    <div className="stack">
      <div className="stage-bars">
        {counts.map((n, i) => {
          const max = Math.max(...counts, 1);
          return (
            <div key={i} className={`stage-bar${i === 5 ? " mastered" : ""}`}>
              <div className="bar">
                <div style={{ height: `${(n / max) * 100}%` }} title={`${n} cards`} />
              </div>
              <div className="lbl">{i === 5 ? "★" : `S${i + 1}`}</div>
            </div>
          );
        })}
      </div>
      <div className="row">
        <span className="badge accent">Stage {state.roundStage}</span>
        <span className="muted small">{state.round.length} card(s) left this round</span>
        <span className="spacer" />
        <span className="muted small">{ladderProgressPct(state)}% to mastery</span>
      </div>
      <FlipCard card={card} onFlipped={setFlipped} />
      <div className="answer-buttons">
        <button className="btn danger" onClick={() => answer(false)} disabled={!flipped} title={flipped ? "" : "Flip the card first"}>
          ✗ Got it wrong
        </button>
        <button className="btn" onClick={() => answer(true)} disabled={!flipped} title={flipped ? "" : "Flip the card first"}>
          ✓ Got it right
        </button>
      </div>
      {!flipped && <p className="muted small" style={{ textAlign: "center" }}>Recall the answer, then flip to check yourself.</p>}
      <ExplainButton card={card} />
    </div>
  );
}

// ---------- AI Mode: type your answer, the AI grades it ----------

function AiStudy({
  state,
  cardById,
  deckId,
  defaultStrictness,
  onChange,
}: {
  state: AiModeState;
  cardById: Map<string, Card>;
  deckId: string;
  defaultStrictness: number;
  onChange: (s: AiModeState) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [strictness, setStrictness] = useState(defaultStrictness);
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; feedback: string; back: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const card = cardById.get(state.order[state.index]);
  useEffect(() => {
    setAnswer("");
    setResult(null);
    setError(null);
  }, [card?.id]);

  if (!card) return null;

  const done = state.index >= state.order.length - 1 && result !== null;
  const correctCount = Object.values(state.results).filter((r) => r.correct).length;

  const submit = async () => {
    if (!answer.trim() || grading) return;
    setGrading(true);
    setError(null);
    try {
      const res = await apiSend<{ correct: boolean; feedback: string; back: string }>(
        "POST",
        `/api/study/${deckId}/grade`,
        { cardId: card.id, answer, strictness },
      );
      setResult(res);
      const prev = state.results[card.id];
      onChange({
        ...state,
        results: {
          ...state.results,
          [card.id]: { correct: res.correct, attempts: (prev?.attempts ?? 0) + 1 },
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grading failed");
    } finally {
      setGrading(false);
    }
  };

  const next = () => {
    if (state.index < state.order.length - 1) onChange({ ...state, index: state.index + 1 });
  };

  return (
    <div className="stack">
      <div className="row">
        <span className="muted small">
          Card {state.index + 1} of {state.order.length} · {correctCount} correct so far
        </span>
        <span className="spacer" />
        <label className="row small muted" style={{ marginBottom: 0 }}>
          AI leniency
          <select
            value={strictness}
            onChange={(e) => setStrictness(Number(e.target.value))}
            style={{ width: "auto" }}
          >
            <option value={1}>1 — very lenient</option>
            <option value={2}>2 — lenient</option>
            <option value={3}>3 — balanced</option>
            <option value={4}>4 — strict</option>
            <option value={5}>5 — aggressive</option>
          </select>
        </label>
      </div>

      <FlipCard card={card} flippable={false} />
      <p className="muted small" style={{ textAlign: "center" }}>
        No flipping in AI Mode — type your answer and the AI decides.
      </p>

      {!result ? (
        <div className="stack" style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
          <textarea
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
            }}
          />
          {error && <p className="error-text">{error}</p>}
          <button className="btn" onClick={submit} disabled={grading || !answer.trim()}>
            {grading ? <span className="spinner" /> : "Submit answer"}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
          <div
            className="panel"
            style={{ borderColor: result.correct ? "var(--ok)" : "var(--danger)" }}
          >
            <b>{result.correct ? "✓ Correct!" : "✗ Not quite."}</b>
            <Markdown text={result.feedback} />
            <p className="muted small">Card back: {result.back}</p>
          </div>
          {!done ? (
            <button className="btn" onClick={next}>
              Next card →
            </button>
          ) : (
            <div className="panel study-done">
              <div className="big-emoji">🎓</div>
              <h3>
                Session complete — {correctCount} / {state.order.length} correct
              </h3>
              <p className="muted small">Restart to run it again, or push weak cards through Leitner Mode.</p>
            </div>
          )}
        </div>
      )}
      <ExplainButton card={card} />
    </div>
  );
}
