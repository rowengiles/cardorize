import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./state";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Create from "./pages/Create";
import DeckDetail from "./pages/DeckDetail";
import Study from "./pages/Study";
import Browse from "./pages/Browse";
import Feed from "./pages/Feed";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";

export default function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <span className="spinner" />
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/app" replace /> : <Landing />} />
      <Route path="/auth" element={user ? <Navigate to="/app" replace /> : <Auth />} />
      <Route path="/app" element={user ? <Layout /> : <Navigate to="/auth" replace />}>
        <Route index element={<Dashboard />} />
        <Route path="create" element={<Create />} />
        <Route path="decks/:id" element={<DeckDetail />} />
        <Route path="decks/:id/study" element={<Study />} />
        <Route path="browse" element={<Browse />} />
        <Route path="feed" element={<Feed />} />
        <Route path="settings" element={<Settings />} />
        <Route path="u/:username" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
