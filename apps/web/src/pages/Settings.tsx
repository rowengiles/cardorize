import { useEffect, useState } from "react";
import {
  APPEARANCES,
  DIFFICULTIES,
  PRIVACY_LEVELS,
  type Appearance,
  type Difficulty,
  type Privacy,
  type Reminder,
} from "@cardorize/shared";
import { apiGet, apiSend } from "../api";
import { useAuth } from "../state";

export default function Settings() {
  const { user, settings, refreshSettings, setUser } = useAuth();
  const [message, setMessage] = useState<string | null>(null);

  if (!settings) return <span className="spinner" />;

  const update = async (patch: Record<string, unknown>) => {
    setMessage(null);
    try {
      await apiSend("PUT", "/api/settings", patch);
      await refreshSettings();
      setMessage("Saved ✔");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to save");
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>Settings</h1>
      {message && <p className="ok-text">{message}</p>}

      <div className="panel">
        <h3>AI Providers (bring your own key)</h3>
        <p className="muted small">
          Keys are encrypted (AES-256-GCM) and stay server-side — they are never sent back to your browser.
          Anthropic powers generation, grading and explanations; OpenAI (optional) powers audio
          transcription via Whisper.
        </p>
        <KeyRow provider="anthropic" configured={settings.providers.includes("anthropic")} onChanged={refreshSettings} />
        <KeyRow provider="openai" configured={settings.providers.includes("openai")} onChanged={refreshSettings} />
        <div className="field" style={{ marginTop: 10 }}>
          <label>Generation model</label>
          <select value={settings.generationModel} onChange={(e) => update({ generationModel: e.target.value })}>
            <option value="claude-opus-4-8">claude-opus-4-8 (default — most capable)</option>
            <option value="claude-sonnet-5">claude-sonnet-5 (faster / cheaper)</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5 (fastest, simple sources)</option>
          </select>
        </div>
      </div>

      <div className="panel">
        <h3>Study defaults</h3>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>Default difficulty for new sets</label>
            <select
              value={settings.defaultDifficulty}
              onChange={(e) => update({ defaultDifficulty: e.target.value as Difficulty })}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>AI Mode leniency (1 lenient → 5 aggressive)</label>
            <select value={settings.aiStrictness} onChange={(e) => update({ aiStrictness: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Privacy & appearance</h3>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>Profile & feed visibility</label>
            <select value={settings.privacy} onChange={(e) => update({ privacy: e.target.value as Privacy })}>
              {PRIVACY_LEVELS.map((p) => (
                <option key={p} value={p}>
                  {p === "public"
                    ? "Public"
                    : p === "link"
                      ? "Private (shareable with link)"
                      : p === "friends"
                        ? "Friends only"
                        : "Private"}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>Theme</label>
            <select value={settings.appearance} onChange={(e) => update({ appearance: e.target.value as Appearance })}>
              {APPEARANCES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <TotpPanel totpEnabled={!!user?.totpEnabled} onChanged={(enabled) => setUser(user ? { ...user, totpEnabled: enabled } : user)} />
      <RemindersPanel />
    </div>
  );
}

function KeyRow({
  provider,
  configured,
  onChanged,
}: {
  provider: "anthropic" | "openai";
  configured: boolean;
  onChanged: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("PUT", "/api/settings/keys", { provider, key: key.trim() });
      setKey("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await apiSend("DELETE", `/api/settings/keys/${provider}`);
    await onChanged();
  };

  return (
    <div className="field">
      <label>
        {provider === "anthropic" ? "Anthropic API key" : "OpenAI API key (audio transcription)"}{" "}
        {configured && <span className="ok-text">· configured ✔</span>}
      </label>
      <div className="row">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={configured ? "Replace stored key…" : provider === "anthropic" ? "sk-ant-…" : "sk-…"}
          style={{ flex: 1 }}
          autoComplete="off"
        />
        <button className="btn small-btn" onClick={save} disabled={busy || !key.trim()}>
          Save
        </button>
        {configured && (
          <button className="btn danger small-btn" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function TotpPanel({ totpEnabled, onChanged }: { totpEnabled: boolean; onChanged: (enabled: boolean) => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const begin = async () => {
    setError(null);
    const res = await apiSend<{ secret: string; otpauth: string }>("POST", "/api/auth/totp/setup");
    setSetup(res);
  };

  const confirm = async () => {
    setError(null);
    try {
      await apiSend("POST", "/api/auth/totp/enable", { code });
      setSetup(null);
      setCode("");
      setOkMsg("Two-factor authentication is on ✔");
      onChanged(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    }
  };

  const disable = async () => {
    setError(null);
    try {
      await apiSend("POST", "/api/auth/totp/disable", { code });
      setCode("");
      setOkMsg("Two-factor authentication is off");
      onChanged(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    }
  };

  return (
    <div className="panel">
      <h3>Two-factor authentication (TOTP)</h3>
      {okMsg && <p className="ok-text">{okMsg}</p>}
      {!totpEnabled && !setup && (
        <>
          <p className="muted small">Add a 6-digit authenticator code to every sign-in.</p>
          <button className="btn secondary" onClick={begin}>
            Set up TOTP
          </button>
        </>
      )}
      {setup && (
        <div className="stack">
          <p className="small">
            Add this secret to your authenticator app (Google Authenticator, Aegis, 1Password…):
          </p>
          <code style={{ fontSize: "1.05rem", padding: "8px 12px", wordBreak: "break-all" }}>{setup.secret}</code>
          <p className="muted small" style={{ wordBreak: "break-all" }}>
            or use the URI: <code>{setup.otpauth}</code>
          </p>
          <div className="row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              style={{ maxWidth: 160 }}
            />
            <button className="btn small-btn" onClick={confirm} disabled={code.length !== 6}>
              Verify & enable
            </button>
          </div>
        </div>
      )}
      {totpEnabled && (
        <div className="row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit code to disable"
            inputMode="numeric"
            style={{ maxWidth: 200 }}
          />
          <button className="btn danger small-btn" onClick={disable} disabled={code.length !== 6}>
            Disable TOTP
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [title, setTitle] = useState("Study session");
  const [time, setTime] = useState("18:00");
  const [repeat, setRepeat] = useState<"daily" | "weekly">("daily");

  const load = () => {
    apiGet<{ reminders: Reminder[] }>("/api/reminders").then(({ reminders }) => setReminders(reminders));
  };
  useEffect(load, []);

  const add = async () => {
    await apiSend("POST", "/api/reminders", { title, time, repeat });
    load();
  };
  const remove = async (id: string) => {
    await apiSend("DELETE", `/api/reminders/${id}`);
    load();
  };

  return (
    <div className="panel">
      <h3>Daily reminders</h3>
      <p className="muted small">
        Never miss a study session. (In-app for now — push and email delivery are coming.)
      </p>
      <div className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 2, minWidth: 160 }} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 120 }} />
        <select value={repeat} onChange={(e) => setRepeat(e.target.value as "daily" | "weekly")} style={{ width: 110 }}>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>
        <button className="btn small-btn" onClick={add} disabled={!title.trim()}>
          Add
        </button>
      </div>
      {reminders.map((r) => (
        <div className="job-row" key={r.id}>
          <span>
            ⏰ {r.title} — {r.time} ({r.repeat})
          </span>
          <span className="spacer" />
          <button className="btn ghost small-btn" onClick={() => remove(r.id)}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
