import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../state";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <NavLink to="/app" className="logo">
            Card<b>orize</b>
          </NavLink>
          <NavLink to="/app" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Dashboard
          </NavLink>
          <NavLink to="/app/create" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Create
          </NavLink>
          <NavLink to="/app/browse" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Browse
          </NavLink>
          <NavLink to="/app/feed" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Feed
          </NavLink>
          <span className="spacer" />
          <NavLink to={`/app/u/${user?.username}`} className="nav-link">
            @{user?.username}
          </NavLink>
          <NavLink to="/app/settings" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Settings
          </NavLink>
          <button
            className="btn ghost small-btn"
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="page">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </>
  );
}
