import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PublicUser } from "@cardorize/shared";
import { ApiError, apiSend } from "../api";
import { useAuth } from "../state";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setUser, refreshSettings } = useAuth();
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login" ? { username, password, ...(totp ? { totp } : {}) } : { username, password };
      const res = await apiSend<{ user: PublicUser }>("POST", path, body);
      setUser(res.user);
      await refreshSettings();
      navigate("/app");
    } catch (err) {
      if (err instanceof ApiError && err.requiresTotp) {
        setNeedsTotp(true);
        setError(totp ? err.message : "Enter your 6-digit authenticator code.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 70 }}>
      <Link to="/" className="logo" style={{ display: "block", textAlign: "center", marginBottom: 24 }}>
        Card<b>orize</b>
      </Link>
      <div className="panel">
        <div className="mode-tabs" style={{ marginBottom: 18 }}>
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">
            Sign in
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
            type="button"
          >
            Create account
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
            />
          </div>
          <div className="field">
            <label>Password {mode === "register" && <span className="muted">(8+ characters)</span>}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 8 : 1}
            />
          </div>
          {needsTotp && (
            <div className="field">
              <label>Authenticator code (TOTP)</label>
              <input
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                autoFocus
              />
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <button className="btn" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
            {busy ? <span className="spinner" /> : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        {mode === "register" && (
          <p className="muted small" style={{ marginTop: 12 }}>
            You can add two-factor authentication (TOTP) from Settings after registering.
          </p>
        )}
      </div>
    </div>
  );
}
