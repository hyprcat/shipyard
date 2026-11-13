// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, appRoutes, createAppQueryClient } from "./app";

const renderRoute = (path: string) =>
  render(
    createElement(App, {
      queryClient: createAppQueryClient(),
      router: createMemoryRouter(appRoutes, {
        initialEntries: [path],
      }),
    }),
  );

const createJsonResponse = (status: number, body: unknown) =>
  ({
    headers: new Headers({
      "content-type": "application/json",
    }),
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  }) as Response;

const createAuthenticatedResponse = (onboardingCompletedAt: string | null) => ({
  ok: true,
  session: {
    createdAt: "2026-03-08T00:00:00.000Z",
    expiresAt: "2026-04-07T00:00:00.000Z",
    id: "session-1",
    userId: "user-1",
  },
  user: {
    createdAt: "2026-03-08T00:00:00.000Z",
    email: "owner@shipyard.local",
    id: "user-1",
    onboardingCompletedAt,
  },
});

const createOnboardingState = (
  overrides: Partial<{
    apiKeyCount: number;
    firstIncompleteStep: "team" | "apiKey" | "project" | "complete";
    onboardingCompletedAt: string | null;
    onboardingTeamConfirmedAt: string | null;
    projectCount: number;
    team: {
      id: string;
      name: string;
      slug: string;
    };
  }> = {},
) => {
  const state = {
    apiKeyCount: 0,
    firstIncompleteStep: "team" as const,
    onboardingCompletedAt: null as string | null,
    onboardingTeamConfirmedAt: null as string | null,
    projectCount: 0,
    team: {
      id: "team-1",
      name: "Owner Team",
      slug: "owner-user1",
    },
    ...overrides,
  };

  return {
    ok: true,
    state: {
      ...state,
      team: {
        id: "team-1",
        name: "Owner Team",
        slug: "owner-user1",
        ...overrides.team,
      },
    },
  };
};

const onboardedAuthResponse = createAuthenticatedResponse(
  "2026-03-08T02:00:00.000Z",
);
const completedOnboardingState = createOnboardingState({
  apiKeyCount: 1,
  firstIncompleteStep: "complete",
  onboardingCompletedAt: "2026-03-08T02:00:00.000Z",
  onboardingTeamConfirmedAt: "2026-03-08T01:00:00.000Z",
  projectCount: 1,
});

const createProjectsResponse = (
  projects = [
    {
      createdAt: "2026-03-08T02:00:00.000Z",
      id: "project-1",
      name: "Shipyard Demo",
      slug: "shipyard-demo",
    },
  ],
) => ({
  ok: true,
  projects,
});

const createTeamMembersResponse = (currentUserRole: "owner" | "viewer") => ({
  currentUserRole,
  invitations: [
    {
      email: "viewer@shipyard.local",
      expiresAt: "2026-03-15T00:00:00.000Z",
      id: "invite-1",
      invitedAt: "2026-03-08T00:00:00.000Z",
      role: "viewer",
      status: "pending",
    },
  ],
  members: [
    {
      acceptedAt: "2026-03-08T01:00:00.000Z",
      email: "operator@shipyard.local",
      id: "membership-2",
      invitedAt: "2026-03-08T00:00:00.000Z",
      role: "operator",
      userId: "user-2",
    },
    {
      acceptedAt: "2026-03-08T01:00:00.000Z",
      email: "owner@shipyard.local",
      id: "membership-1",
      invitedAt: "2026-03-08T00:00:00.000Z",
      role: "owner",
      userId: "user-1",
    },
  ],
  ok: true,
});

describe("@shipyard/web", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the public route shell", async () => {
    renderRoute("/");

    expect(
      await screen.findByRole("heading", { name: "Public entrypoint" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Typed React client shell")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeInTheDocument();
  });

  it("redirects anonymous users from protected routes to login", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(401, {
        ok: false,
        error: {
          code: "REQUEST_ERROR",
          message: "Unauthorized",
          statusCode: 401,
        },
      }),
    );

    renderRoute("/projects");

    expect(
      await screen.findByRole("heading", { name: "Sign in to Shipyard" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Please sign in to continue. If you already had a session, it may have expired.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Return after auth:\s*\/projects/),
    ).toBeInTheDocument();
  });

  it("returns onboarded users to their original route after login", async () => {
    let hasLoggedIn = false;

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url === "/api/auth/me") {
        return hasLoggedIn
          ? createJsonResponse(200, onboardedAuthResponse)
          : createJsonResponse(401, {
              ok: false,
              error: {
                code: "REQUEST_ERROR",
                message: "Unauthorized",
                statusCode: 401,
              },
            });
      }

      if (url === "/api/auth/login") {
        hasLoggedIn = true;
        return createJsonResponse(200, onboardedAuthResponse);
      }

      if (url === "/api/onboarding" && hasLoggedIn) {
        return createJsonResponse(200, completedOnboardingState);
      }

      if (url === "/api/projects" && hasLoggedIn) {
        return createJsonResponse(200, createProjectsResponse());
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    renderRoute("/projects");

    await screen.findByRole("heading", { name: "Sign in to Shipyard" });

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "owner@shipyard.local" },
    });
    fireEvent.change(screen.getByLabelText(/Password/), {
      target: { value: "shipyard-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", { name: "Project workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Shipyard Demo")).toBeInTheDocument();
  });

  it("renders the registration page and keeps invalid submissions inline", async () => {
    renderRoute("/register");

    expect(
      await screen.findByRole("heading", {
        name: "Create your Shipyard account",
      }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.change(screen.getByLabelText(/Password/), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("Fix the highlighted fields and try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders an in-app typed 404 shell for unknown routes", async () => {
    renderRoute("/missing");

    expect(
      await screen.findByRole("heading", { name: "Route not found" }),
    ).toBeInTheDocument();
    expect(screen.getByText("404 ROUTE_NOT_FOUND")).toBeInTheDocument();
    expect(screen.getByText("Unknown route")).toBeInTheDocument();
  });

  it("redirects incomplete users from projects into guided onboarding", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(200, createAuthenticatedResponse(null)),
      )
      .mockResolvedValueOnce(createJsonResponse(200, createOnboardingState()))
      .mockResolvedValueOnce(createJsonResponse(200, createOnboardingState()));

    renderRoute("/projects");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm team" }),
      ).toBeEnabled(),
    );
  });

  it("resumes onboarding at the first incomplete step", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(200, createAuthenticatedResponse(null)),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          200,
          createOnboardingState({
            apiKeyCount: 1,
            firstIncompleteStep: "project",
            onboardingTeamConfirmedAt: "2026-03-08T01:00:00.000Z",
          }),
        ),
      );

    renderRoute("/onboarding");

    expect(
      await screen.findByRole("button", { name: "Create first project" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm team" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create first API key" }),
    ).not.toBeInTheDocument();
  });

  it("completes onboarding and lands on projects with a key and project", async () => {
    let currentState = createOnboardingState();
    let projects = createProjectsResponse().projects;

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/me") {
        return createJsonResponse(
          200,
          createAuthenticatedResponse(currentState.state.onboardingCompletedAt),
        );
      }

      if (url === "/api/onboarding" && method === "GET") {
        return createJsonResponse(200, currentState);
      }

      if (url === "/api/onboarding/team" && method === "POST") {
        currentState = createOnboardingState({
          firstIncompleteStep: "apiKey",
          onboardingTeamConfirmedAt: "2026-03-08T01:00:00.000Z",
          team: {
            ...currentState.state.team,
            name: "Owner Workspace",
          },
        });

        return createJsonResponse(200, currentState);
      }

      if (url === "/api/onboarding/api-keys" && method === "POST") {
        currentState = createOnboardingState({
          apiKeyCount: 1,
          firstIncompleteStep: "project",
          onboardingTeamConfirmedAt: "2026-03-08T01:00:00.000Z",
        });

        return createJsonResponse(200, {
          apiKey: {
            id: "key-1",
            label: "Local CLI",
            prefix: "sy_abcd1234",
            secret: "sy_abcd1234_example",
          },
          ok: true,
          state: currentState.state,
        });
      }

      if (url === "/api/onboarding/projects" && method === "POST") {
        projects = createProjectsResponse().projects;
        currentState = createOnboardingState({
          apiKeyCount: 1,
          firstIncompleteStep: "complete",
          onboardingCompletedAt: "2026-03-08T02:00:00.000Z",
          onboardingTeamConfirmedAt: "2026-03-08T01:00:00.000Z",
          projectCount: 1,
        });

        return createJsonResponse(201, {
          ok: true,
          project: projects[0],
          state: currentState.state,
        });
      }

      if (url === "/api/projects") {
        return createJsonResponse(200, createProjectsResponse(projects));
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderRoute("/onboarding");

    await screen.findByRole("heading", { name: "Guided onboarding" });

    fireEvent.change(screen.getByLabelText("Team name"), {
      target: { value: "Owner Workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm team" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Create first API key" }),
    );
    expect(await screen.findByText("sy_abcd1234_example")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Shipyard Demo" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Create first project" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Project workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Shipyard Demo")).toBeInTheDocument();

    const apiKeysStat = screen
      .getByText("API keys", { selector: "span" })
      .closest(".team-stat");
    const projectsStat = screen
      .getByText("Projects", { selector: "span" })
      .closest(".team-stat");

    expect(apiKeysStat).not.toBeNull();
    expect(projectsStat).not.toBeNull();
    expect(
      within(apiKeysStat as HTMLElement).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(projectsStat as HTMLElement).getByText("1"),
    ).toBeInTheDocument();
  });

  it("renders the team members route with owner actions and invitations", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, onboardedAuthResponse))
      .mockResolvedValueOnce(createJsonResponse(200, completedOnboardingState))
      .mockResolvedValueOnce(
        createJsonResponse(200, createTeamMembersResponse("owner")),
      );

    renderRoute("/teams/team-1/members");

    expect(
      await screen.findByRole("heading", { name: "Manage team members" }),
    ).toBeInTheDocument();
    expect(screen.getByText("operator@shipyard.local")).toBeInTheDocument();
    expect(screen.getByText("viewer@shipyard.local")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invite member" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Change role for operator@shipyard.local",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove operator@shipyard.local" }),
    ).toBeInTheDocument();
  });

  it("updates a member role in place without refetching the roster", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, onboardedAuthResponse))
      .mockResolvedValueOnce(createJsonResponse(200, completedOnboardingState))
      .mockResolvedValueOnce(
        createJsonResponse(200, createTeamMembersResponse("owner")),
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          member: {
            acceptedAt: "2026-03-08T01:00:00.000Z",
            email: "operator@shipyard.local",
            id: "membership-2",
            invitedAt: "2026-03-08T00:00:00.000Z",
            role: "admin",
            userId: "user-2",
          },
          ok: true,
        }),
      );

    renderRoute("/teams/team-1/members");

    await screen.findByRole("heading", { name: "Manage team members" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Change role for operator@shipyard.local",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Change member role",
    });

    fireEvent.change(within(dialog).getByLabelText("Role"), {
      target: { value: "admin" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save role" }));

    await waitFor(() =>
      expect(screen.getAllByText("Admin")[0]).toBeInTheDocument(),
    );
    expect(screen.queryByText("Operator")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/teams/team-1/members/membership-2",
      expect.objectContaining({
        body: JSON.stringify({ role: "admin" }),
        credentials: "include",
        method: "PATCH",
      }),
    );
  });

  it("renders viewer access as read-only with no management controls in the dom", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, onboardedAuthResponse))
      .mockResolvedValueOnce(createJsonResponse(200, completedOnboardingState))
      .mockResolvedValueOnce(
        createJsonResponse(200, createTeamMembersResponse("viewer")),
      );

    renderRoute("/teams/team-1/members");

    await screen.findByRole("heading", { name: "Manage team members" });

    expect(screen.getByText("Read-only access")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invite member" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Change role for operator@shipyard.local",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove operator@shipyard.local" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Actions" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
