import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState, Table } from "@shipyard/ui";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  formatDateStamp,
  isApiError,
  loadProjects,
  projectsQueryKey,
  useOnboardingStateQuery,
} from "./api";

export const ProjectsPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onboardingQuery = useOnboardingStateQuery();
  const projectsQuery = useQuery({
    queryFn: loadProjects,
    queryKey: projectsQueryKey,
  });

  if (onboardingQuery.isPending || projectsQuery.isPending) {
    return <div className="loading-state">Loading project workspace...</div>;
  }

  if (
    onboardingQuery.error ||
    !onboardingQuery.data ||
    projectsQuery.error ||
    !projectsQuery.data
  ) {
    const message =
      (isApiError(onboardingQuery.error) && onboardingQuery.error.message) ||
      (isApiError(projectsQuery.error) && projectsQuery.error.message) ||
      "Unable to load projects right now.";

    return (
      <div className="app-shell">
        <div className="auth-layout">
          <Card className="panel auth-card">
            <EmptyState
              action={
                <Button onClick={() => navigate("/onboarding")}>
                  Back to onboarding
                </Button>
              }
              description={message}
              title="Project workspace unavailable"
            />
          </Card>
        </div>
      </div>
    );
  }

  const state = onboardingQuery.data.state;
  const projects = projectsQuery.data.projects;

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Projects</p>
          <h1 className="shell-title">Project workspace</h1>
          <p className="shell-copy">
            Review the first project for{" "}
            <span className="inline-code">{state.team.name}</span>, confirm the
            team now has an API key, and continue into the rest of the product.
          </p>
        </div>
        <div className="shell-stat">
          <span>Onboarding</span>
          <strong>Complete</strong>
        </div>
      </header>

      <div className="shell-grid">
        <aside className="panel nav-panel" aria-label="Project summary">
          <Card className="supplementary-panel team-summary-card">
            <div className="supplementary-heading">
              <h3>Workspace summary</h3>
              <p>
                Counts come from the same onboarding state used by the gate.
              </p>
            </div>
            <div className="team-stat-grid">
              <div className="team-stat">
                <span>API keys</span>
                <strong>{state.apiKeyCount}</strong>
              </div>
              <div className="team-stat">
                <span>Projects</span>
                <strong>{projects.length}</strong>
              </div>
            </div>
            <Button
              onClick={() => navigate(`/teams/${state.team.id}/members`)}
              tone="secondary"
            >
              Team members
            </Button>
            <Button onClick={() => navigate("/operator")} tone="secondary">
              Operator shell
            </Button>
          </Card>
        </aside>

        <main className="panel detail-panel">
          {searchParams.get("onboarding") === "complete" ? (
            <p className="inline-notice">
              Onboarding complete. Your first API key and project are ready.
            </p>
          ) : null}

          <Card className="supplementary-panel">
            <div className="supplementary-heading table-heading">
              <div>
                <h3>Projects</h3>
                <p>
                  New users land here with at least one API key and one project
                  already provisioned.
                </p>
              </div>
              <Badge tone="success">{projects.length} ready</Badge>
            </div>
            <Table
              caption="Projects"
              columns={["Project", "Created", "Action"]}
              emptyState="No projects created yet."
              rows={projects.map((project) => [
                <div className="table-identity" key={`${project.id}-identity`}>
                  <strong>{project.name}</strong>
                  <span>{project.slug}</span>
                </div>,
                <span key={`${project.id}-created`}>
                  {formatDateStamp(project.createdAt)}
                </span>,
                <Button
                  key={`${project.id}-action`}
                  onClick={() => navigate("/operator")}
                  tone="secondary"
                >
                  Open operator shell
                </Button>,
              ])}
            />
          </Card>
        </main>
      </div>
    </div>
  );
};
