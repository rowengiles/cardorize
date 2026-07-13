import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser, UserSettings } from "@cardorize/shared";
import { apiGet, apiSend } from "./api";

interface AuthCtx {
  user: PublicUser | null;
  settings: UserSettings | null;
  loading: boolean;
  setUser: (u: PublicUser | null) => void;
  refreshSettings: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  settings: null,
  loading: true,
  setUser: () => {},
  refreshSettings: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSettings = async () => {
    try {
      const { settings } = await apiGet<{ settings: UserSettings }>("/api/settings");
      setSettings(settings);
    } catch {
      setSettings(null);
    }
  };

  useEffect(() => {
    apiGet<{ user: PublicUser }>("/api/auth/me")
      .then(({ user }) => {
        setUser(user);
        return refreshSettings();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.appearance ?? "default";
  }, [settings?.appearance]);

  const logout = async () => {
    await apiSend("POST", "/api/auth/logout").catch(() => {});
    setUser(null);
    setSettings(null);
  };

  return (
    <Ctx.Provider value={{ user, settings, loading, setUser, refreshSettings, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
