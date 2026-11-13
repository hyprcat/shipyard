import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, Dialog, EmptyState } from "@shipyard/ui";
import {
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  buildAuthPath,
  loadGroupedNavigation,
  useAuthSessionQuery,
} from "./api";
import {
  type AppScreen,
  type RouteSection,
  groupedNavigation,
  sectionLabels,
} from "./screens";

export const ScreenRoute = ({ screen }: { readonly screen: AppScreen }) => {
  const navigationQuery = useQuery({
    queryFn: loadGroupedNavigation,
    queryKey: ["navigation", "grouped"] as const,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const screenQuery = useQuery({
    queryFn: async () => screen,
    queryKey: screen.queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const navigate = useNavigate();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    setIsDialogOpen(false);
  }, [screen.id]);

  if (navigationQuery.isPending || screenQuery.isPending) {
    return <div className="loading-state">Loading Shipyard shell...</div>;
  }

  const activeScreen = screenQuery.data ?? screen;
  const navigation = navigationQuery.data ?? groupedNavigation;
  const routeBadgeTone: "danger" | "info" | "success" | "warning" =
    activeScreen.kind === "not-found"
      ? "danger"
      : activeScreen.section === "operator"
        ? "warning"
        : activeScreen.section === "authenticated"
          ? "success"
          : "info";

  const supplementaryContent =
    activeScreen.id === "operator" ? (
      <>
        <Card className="supplementary-panel">
          <div className="supplementary-heading">
            <h3>Shared dialog framing</h3>
            <p>
              Operator workflows can mount one modal shell instead of page-local
              copies.
            </p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>
            Preview deploy dialog
          </Button>
        </Card>
        <Dialog
          actions={
            <Button onClick={() => setIsDialogOpen(false)} tone="secondary">
              Close preview
            </Button>
          }
          description="Operator confirmations can share the same dialog, buttons, and spacing."
          onClose={() => setIsDialogOpen(false)}
          open={isDialogOpen}
          title="Redeploy preview"
        >
          <p className="dialog-copy">
            Immutable deploy actions stay consistent across platform surfaces.
          </p>
        </Dialog>
      </>
    ) : null;

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Shipyard</p>
          <h1 className="shell-title">Typed React client shell</h1>
          <p className="shell-copy">
            Vite, React Router, and TanStack Query are wired together for
            public, authenticated, and operator routes.
          </p>
        </div>
        <div className="shell-stat">
          <span>Route group</span>
          <strong>
            {activeScreen.kind === "not-found"
              ? "Fallback 404"
              : sectionLabels[activeScreen.section]}
          </strong>
        </div>
      </header>

      <div className="shell-grid">
        <aside className="panel nav-panel" aria-label="Route navigation">
          {Object.entries(navigation).map(([section, links]) => (
            <div className="nav-group" key={section}>
              <p className="nav-heading">
                {sectionLabels[section as RouteSection]}
              </p>
              <div className="nav-stack">
                {links.map((link) => (
                  <NavLink
                    className={({ isActive }) =>
                      isActive ? "nav-link active" : "nav-link"
                    }
                    key={link.to}
                    to={link.to}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main className="panel detail-panel">
          <div className="badge-row">
            <Badge tone={routeBadgeTone}>
              {activeScreen.kind === "not-found"
                ? `${activeScreen.status} ${activeScreen.errorCode}`
                : sectionLabels[activeScreen.section]}
            </Badge>
            <span className="query-key">
              Query key: {activeScreen.queryKey.join(" / ")}
            </span>
          </div>

          <h2 className="detail-title">{activeScreen.title}</h2>
          <p className="detail-copy">{activeScreen.summary}</p>

          {activeScreen.kind === "not-found" ? (
            <EmptyState
              action={
                <Button onClick={() => navigate("/")}>Return home</Button>
              }
              description="The app shell stayed mounted, and shared primitives can still guide recovery."
              title="Unknown route"
            />
          ) : (
            <>
              <ul className="highlight-list">
                {activeScreen.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>

              <div className="cta-row">
                <Button onClick={() => navigate(activeScreen.cta.to)}>
                  {activeScreen.cta.label}
                </Button>
              </div>
            </>
          )}

          {supplementaryContent}
        </main>
      </div>
    </div>
  );
};

export const ProtectedRoute = () => {
  const location = useLocation();
  const sessionQuery = useAuthSessionQuery();
  const redirectTo = `${location.pathname}${location.search}`;

  if (sessionQuery.isPending) {
    return <div className="loading-state">Checking Shipyard session...</div>;
  }

  if (sessionQuery.error) {
    return (
      <Navigate
        replace
        to={buildAuthPath("/login", redirectTo, "auth-check-failed")}
      />
    );
  }

  if (!sessionQuery.data) {
    return (
      <Navigate
        replace
        to={buildAuthPath("/login", redirectTo, "auth-required")}
      />
    );
  }

  return <Outlet />;
};
