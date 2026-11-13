import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState, Input } from "@shipyard/ui";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import {
  type AuthenticatedResponse,
  type OnboardingApiKeyResponse,
  type OnboardingProjectResponse,
  type OnboardingState,
  type OnboardingStateResponse,
  type OnboardingStep,
  type ProjectsResponse,
  authQueryKey,
  isApiError,
  onboardingQueryKey,
  projectsQueryKey,
  requestJson,
  useOnboardingStateQuery,
} from "./api";

const onboardingStepOrder: readonly OnboardingStep[] = [
  "team",
  "apiKey",
  "project",
  "complete",
] as const;

const onboardingStepLabels: Record<
  Exclude<OnboardingStep, "complete">,
  string
> = {
  apiKey: "Create API key",
  project: "Create project",
  team: "Confirm team",
};

const getOnboardingStepStatus = (
  activeStep: OnboardingStep,
  step: Exclude<OnboardingStep, "complete">,
): "completed" | "current" | "pending" => {
  const activeIndex = onboardingStepOrder.indexOf(activeStep);
  const stepIndex = onboardingStepOrder.indexOf(step);

  if (activeStep === "complete" || stepIndex < activeIndex) {
    return "completed";
  }

  if (stepIndex === activeIndex) {
    return "current";
  }

  return "pending";
};

export const OnboardingGate = () => {
  const onboardingQuery = useOnboardingStateQuery();

  if (onboardingQuery.isPending) {
    return <div className="loading-state">Checking onboarding progress...</div>;
  }

  if (onboardingQuery.error || !onboardingQuery.data) {
    const message = isApiError(onboardingQuery.error)
      ? onboardingQuery.error.message
      : "Unable to load onboarding progress right now.";

    return (
      <div className="app-shell">
        <div className="auth-layout">
          <Card className="panel auth-card">
            <EmptyState
              action={
                <Button onClick={() => onboardingQuery.refetch()}>
                  Retry onboarding check
                </Button>
              }
              description={message}
              title="Onboarding status unavailable"
            />
          </Card>
        </div>
      </div>
    );
  }

  if (onboardingQuery.data.state.firstIncompleteStep !== "complete") {
    return <Navigate replace to="/onboarding" />;
  }

  return <Outlet />;
};

export const OnboardingPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onboardingQuery = useOnboardingStateQuery();
  const [teamName, setTeamName] = useState("");
  const [apiKeyLabel, setApiKeyLabel] = useState("Local CLI");
  const [projectName, setProjectName] = useState("Shipyard Demo");
  const [createdApiKey, setCreatedApiKey] = useState<
    OnboardingApiKeyResponse["apiKey"] | null
  >(null);

  const setOnboardingState = (state: OnboardingState) => {
    queryClient.setQueryData<OnboardingStateResponse>(onboardingQueryKey, {
      ok: true,
      state,
    });
  };

  useEffect(() => {
    const state = onboardingQuery.data?.state;

    if (!state) {
      return;
    }

    setTeamName((current) => (current.length > 0 ? current : state.team.name));
    setProjectName((current) =>
      current.length > 0 ? current : "Shipyard Demo",
    );
  }, [onboardingQuery.data]);

  const confirmTeamMutation = useMutation({
    mutationFn: (name: string) =>
      requestJson<OnboardingStateResponse>("/api/onboarding/team", {
        body: JSON.stringify({ name }),
        method: "POST",
      }),
    onSuccess: ({ state }) => {
      setOnboardingState(state);
      setTeamName(state.team.name);
    },
  });

  const createApiKeyMutation = useMutation({
    mutationFn: (label: string) =>
      requestJson<OnboardingApiKeyResponse>("/api/onboarding/api-keys", {
        body: JSON.stringify({ label }),
        method: "POST",
      }),
    onSuccess: ({ apiKey, state }) => {
      setCreatedApiKey(apiKey);
      setOnboardingState(state);
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: (name: string) =>
      requestJson<OnboardingProjectResponse>("/api/onboarding/projects", {
        body: JSON.stringify({ name }),
        method: "POST",
      }),
    onSuccess: ({ project, state }) => {
      setOnboardingState(state);
      queryClient.setQueryData<ProjectsResponse>(
        projectsQueryKey,
        (current) => ({
          ok: true,
          projects: [...(current?.projects ?? []), project].sort(
            (left, right) => left.createdAt.localeCompare(right.createdAt),
          ),
        }),
      );
      queryClient.setQueryData<AuthenticatedResponse | null>(
        authQueryKey,
        (current) =>
          current
            ? {
                ...current,
                user: {
                  ...current.user,
                  onboardingCompletedAt: state.onboardingCompletedAt,
                },
              }
            : current,
      );
      navigate("/projects?onboarding=complete", { replace: true });
    },
  });

  if (onboardingQuery.isPending) {
    return <div className="loading-state">Loading guided onboarding...</div>;
  }

  if (onboardingQuery.error || !onboardingQuery.data) {
    const message = isApiError(onboardingQuery.error)
      ? onboardingQuery.error.message
      : "Unable to load onboarding right now.";

    return (
      <div className="app-shell">
        <div className="auth-layout">
          <Card className="panel auth-card">
            <EmptyState
              action={
                <Button onClick={() => onboardingQuery.refetch()}>
                  Retry onboarding
                </Button>
              }
              description={message}
              title="Guided onboarding unavailable"
            />
          </Card>
        </div>
      </div>
    );
  }

  const state = onboardingQuery.data.state;

  if (state.firstIncompleteStep === "complete") {
    return <Navigate replace to="/projects" />;
  }

  const currentStep = state.firstIncompleteStep;
  const canSubmitTeam = teamName.trim().length >= 2;
  const canSubmitApiKey = apiKeyLabel.trim().length >= 2;
  const canSubmitProject = projectName.trim().length >= 2;

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Getting started</p>
          <h1 className="shell-title">Guided onboarding</h1>
          <p className="shell-copy">
            Confirm your default team, generate a first API key, and create a
            starter project without leaving the protected shell.
          </p>
        </div>
        <div className="shell-stat">
          <span>Current step</span>
          <strong>{onboardingStepLabels[currentStep]}</strong>
        </div>
      </header>

      <div className="shell-grid">
        <aside className="panel nav-panel" aria-label="Onboarding progress">
          <Card className="supplementary-panel team-summary-card">
            <div className="supplementary-heading">
              <h3>Progress</h3>
              <p>Resume always opens on the first incomplete step.</p>
            </div>
            <div className="onboarding-step-list">
              {(
                [
                  "team",
                  "apiKey",
                  "project",
                ] as const satisfies readonly Exclude<
                  OnboardingStep,
                  "complete"
                >[]
              ).map((step) => (
                <div
                  className="onboarding-step-item"
                  key={step}
                  data-status={getOnboardingStepStatus(currentStep, step)}
                >
                  <div>
                    <strong>{onboardingStepLabels[step]}</strong>
                    <p>
                      {step === "team"
                        ? state.team.slug
                        : step === "apiKey"
                          ? `${state.apiKeyCount} key ready`
                          : `${state.projectCount} project ready`}
                    </p>
                  </div>
                  <Badge
                    tone={
                      getOnboardingStepStatus(currentStep, step) === "completed"
                        ? "success"
                        : getOnboardingStepStatus(currentStep, step) ===
                            "current"
                          ? "warning"
                          : "info"
                    }
                  >
                    {getOnboardingStepStatus(currentStep, step)}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          {createdApiKey ? (
            <Card className="supplementary-panel">
              <div className="supplementary-heading">
                <h3>Store this API key now</h3>
                <p>Shipyard only shows the generated secret once.</p>
              </div>
              <pre className="secret-preview">
                <code>{createdApiKey.secret}</code>
              </pre>
              <p className="table-note">
                Label: {createdApiKey.label} ({createdApiKey.prefix})
              </p>
            </Card>
          ) : null}
        </aside>

        <main className="panel detail-panel">
          <Card className="supplementary-panel">
            {currentStep === "team" ? (
              <>
                <div className="supplementary-heading">
                  <h3>Confirm your default team</h3>
                  <p>
                    Registration already created a workspace for you. Keep the
                    default name or rename it once before moving on.
                  </p>
                </div>
                <form
                  className="auth-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    confirmTeamMutation.mutate(teamName.trim());
                  }}
                >
                  <label className="field-label">
                    Team name
                    <Input
                      onChange={(event) => setTeamName(event.target.value)}
                      value={teamName}
                    />
                  </label>
                  <p className="field-help">
                    Team slug:{" "}
                    <span className="inline-code">{state.team.slug}</span>
                  </p>
                  {confirmTeamMutation.error ? (
                    <p
                      className="inline-notice inline-notice--danger"
                      role="alert"
                    >
                      {confirmTeamMutation.error.message}
                    </p>
                  ) : null}
                  <div className="cta-row">
                    <Button
                      disabled={!canSubmitTeam || confirmTeamMutation.isPending}
                      type="submit"
                    >
                      {confirmTeamMutation.isPending
                        ? "Saving..."
                        : "Confirm team"}
                    </Button>
                  </div>
                </form>
              </>
            ) : null}

            {currentStep === "apiKey" ? (
              <>
                <div className="supplementary-heading">
                  <h3>Create your first API key</h3>
                  <p>
                    Use this key for the CLI, local scripts, or any automation
                    that needs team-scoped access.
                  </p>
                </div>
                <form
                  className="auth-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createApiKeyMutation.mutate(apiKeyLabel.trim());
                  }}
                >
                  <label className="field-label">
                    API key label
                    <Input
                      onChange={(event) => setApiKeyLabel(event.target.value)}
                      value={apiKeyLabel}
                    />
                  </label>
                  <p className="field-help">
                    The secret is shown once after creation. Store it before you
                    leave this flow.
                  </p>
                  {createApiKeyMutation.error ? (
                    <p
                      className="inline-notice inline-notice--danger"
                      role="alert"
                    >
                      {createApiKeyMutation.error.message}
                    </p>
                  ) : null}
                  <div className="cta-row">
                    <Button
                      disabled={
                        !canSubmitApiKey || createApiKeyMutation.isPending
                      }
                      type="submit"
                    >
                      {createApiKeyMutation.isPending
                        ? "Creating..."
                        : "Create first API key"}
                    </Button>
                  </div>
                </form>
              </>
            ) : null}

            {currentStep === "project" ? (
              <>
                <div className="supplementary-heading">
                  <h3>Create your first project</h3>
                  <p>
                    Shipyard will generate a slug automatically and send you to
                    the project workspace as soon as the project exists.
                  </p>
                </div>
                {state.apiKeyCount > 0 && !createdApiKey ? (
                  <p className="inline-notice">
                    This team already has an API key. Finish onboarding by
                    creating the first project.
                  </p>
                ) : null}
                <form
                  className="auth-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createProjectMutation.mutate(projectName.trim());
                  }}
                >
                  <label className="field-label">
                    Project name
                    <Input
                      onChange={(event) => setProjectName(event.target.value)}
                      value={projectName}
                    />
                  </label>
                  <p className="field-help">
                    Project count after save: {state.projectCount + 1}
                  </p>
                  {createProjectMutation.error ? (
                    <p
                      className="inline-notice inline-notice--danger"
                      role="alert"
                    >
                      {createProjectMutation.error.message}
                    </p>
                  ) : null}
                  <div className="cta-row">
                    <Button
                      disabled={
                        !canSubmitProject || createProjectMutation.isPending
                      }
                      type="submit"
                    >
                      {createProjectMutation.isPending
                        ? "Creating..."
                        : "Create first project"}
                    </Button>
                  </div>
                </form>
              </>
            ) : null}
          </Card>
        </main>
      </div>
    </div>
  );
};
