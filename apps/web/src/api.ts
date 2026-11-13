import { useQuery } from "@tanstack/react-query";
import { groupedNavigation } from "./screens";

type AuthUser = {
  readonly createdAt: string;
  readonly email: string;
  readonly id: string;
  readonly onboardingCompletedAt: string | null;
};

type AuthSession = {
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly userId: string;
};

export type AuthenticatedResponse = {
  readonly ok: true;
  readonly session: AuthSession;
  readonly user: AuthUser;
};

export type TeamRole = "owner" | "admin" | "operator" | "viewer";

export type TeamMember = {
  readonly acceptedAt: string | null;
  readonly email: string;
  readonly id: string;
  readonly invitedAt: string;
  readonly role: TeamRole;
  readonly userId: string;
};

type TeamInvitation = {
  readonly email: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly invitedAt: string;
  readonly role: TeamRole;
  readonly status: "expired" | "pending";
};

export type TeamMembersResponse = {
  readonly currentUserRole: TeamRole;
  readonly invitations: readonly TeamInvitation[];
  readonly members: readonly TeamMember[];
  readonly ok: true;
};

export type TeamInvitationResponse = {
  readonly invitation: TeamInvitation;
  readonly ok: true;
};

export type TeamMemberResponse = {
  readonly member: TeamMember;
  readonly ok: true;
};

export type OnboardingStep = "team" | "apiKey" | "project" | "complete";

export type OnboardingState = {
  readonly apiKeyCount: number;
  readonly firstIncompleteStep: OnboardingStep;
  readonly onboardingCompletedAt: string | null;
  readonly onboardingTeamConfirmedAt: string | null;
  readonly projectCount: number;
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
};

export type OnboardingStateResponse = {
  readonly ok: true;
  readonly state: OnboardingState;
};

export type OnboardingApiKeyResponse = {
  readonly apiKey: {
    readonly id: string;
    readonly label: string;
    readonly prefix: string;
    readonly secret: string;
  };
  readonly ok: true;
  readonly state: OnboardingState;
};

type ProjectSummary = {
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
};

export type OnboardingProjectResponse = {
  readonly ok: true;
  readonly project: ProjectSummary;
  readonly state: OnboardingState;
};

export type ProjectsResponse = {
  readonly ok: true;
  readonly projects: readonly ProjectSummary[];
};

type ApiErrorDetail = {
  readonly message: string;
  readonly path: string;
};

type ApiErrorResponse = {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly details?: readonly ApiErrorDetail[];
    readonly message: string;
    readonly statusCode: number;
  };
};

type ApiError = Error & {
  readonly code: string;
  readonly details?: readonly ApiErrorDetail[];
  readonly statusCode: number;
};

export type AuthMode = "login" | "register";
export type FieldErrors = Partial<Record<"email" | "password", string>>;

export const authQueryKey = ["auth", "session"] as const;
export const onboardingQueryKey = ["onboarding", "state"] as const;
export const projectsQueryKey = ["projects", "list"] as const;
export const defaultAuthRedirects: Record<AuthMode, string> = {
  login: "/projects",
  register: "/onboarding",
};
export const authNoticeMessages = {
  "auth-check-failed":
    "We could not verify your session. Sign in again to continue.",
  "auth-required":
    "Please sign in to continue. If you already had a session, it may have expired.",
} as const satisfies Record<string, string>;
export const authPageContent = {
  login: {
    badgeTone: "success",
    callouts: [
      "Return directly to the route you originally asked for.",
      "Inline errors stay attached to the relevant field or form.",
      "Protected routes re-check the current session before rendering.",
    ],
    pendingLabel: "Signing in...",
    submitLabel: "Sign in",
    summary:
      "Resume projects, deployments, and operator workflows without leaving the app shell.",
    switchAction: "Create account",
    switchPrompt: "Need a Shipyard workspace?",
    title: "Sign in to Shipyard",
  },
  register: {
    badgeTone: "info",
    callouts: [
      "Create a fresh account and land in onboarding immediately.",
      "Validation errors stay inline so failed submissions never feel opaque.",
      "The same session state powers registration, login, and route protection.",
    ],
    pendingLabel: "Creating account...",
    submitLabel: "Create account",
    summary:
      "Create a Shipyard account, start a session, and continue straight into onboarding.",
    switchAction: "Sign in",
    switchPrompt: "Already have an account?",
    title: "Create your Shipyard account",
  },
} as const satisfies Record<
  AuthMode,
  {
    readonly badgeTone: "info" | "success";
    readonly callouts: readonly string[];
    readonly pendingLabel: string;
    readonly submitLabel: string;
    readonly summary: string;
    readonly switchAction: string;
    readonly switchPrompt: string;
    readonly title: string;
  }
>;

export const teamRoleOptions = [
  "owner",
  "admin",
  "operator",
  "viewer",
] as const;

export const teamRoleLabels: Record<TeamRole, string> = {
  admin: "Admin",
  operator: "Operator",
  owner: "Owner",
  viewer: "Viewer",
};

export const teamRoleBadgeTones: Record<
  TeamRole,
  "danger" | "info" | "success" | "warning"
> = {
  admin: "warning",
  operator: "info",
  owner: "success",
  viewer: "danger",
};

export const formatDateStamp = (value: string): string => value.slice(0, 10);

export const getMemberAccessState = (member: TeamMember): string =>
  member.acceptedAt ? "Active" : "Pending";

export const getTeamMembersQueryKey = (teamId: string) =>
  ["team", "members", teamId] as const;

export const loadGroupedNavigation = async () => groupedNavigation;
const loadOnboardingState = async (): Promise<OnboardingStateResponse> =>
  requestJson<OnboardingStateResponse>("/api/onboarding");
export const loadProjects = async (): Promise<ProjectsResponse> =>
  requestJson<ProjectsResponse>("/api/projects");

export const normalizeRedirectTo = (value: string | null): string | null => {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/login") ||
    value.startsWith("/register")
  ) {
    return null;
  }

  return value;
};

export const buildAuthPath = (
  path: "/login" | "/register",
  redirectTo: string | null,
  reason?: keyof typeof authNoticeMessages,
): string => {
  const params = new URLSearchParams();
  const safeRedirectTo = normalizeRedirectTo(redirectTo);

  if (safeRedirectTo) {
    params.set("redirectTo", safeRedirectTo);
  }

  if (reason) {
    params.set("reason", reason);
  }

  const query = params.toString();

  return query.length > 0 ? `${path}?${query}` : path;
};

const createApiError = (
  statusCode: number,
  payload?: ApiErrorResponse,
): ApiError =>
  Object.assign(
    new Error(
      payload?.error.message ?? `Request failed with status ${statusCode}`,
    ),
    {
      code: payload?.error.code ?? "REQUEST_ERROR",
      details: payload?.error.details,
      statusCode,
    },
  );

export const isApiError = (error: unknown): error is ApiError =>
  error instanceof Error &&
  "statusCode" in error &&
  typeof error.statusCode === "number";

export const requestJson = async <T>(
  input: string,
  init: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
  const payload = (await response.json().catch(() => undefined)) as
    | ApiErrorResponse
    | T
    | undefined;

  if (!response.ok) {
    throw createApiError(
      response.status,
      payload as ApiErrorResponse | undefined,
    );
  }

  return payload as T;
};

const loadAuthSession = async (): Promise<AuthenticatedResponse | null> => {
  try {
    return await requestJson<AuthenticatedResponse>("/api/auth/me");
  } catch (error) {
    if (isApiError(error) && error.statusCode === 401) {
      return null;
    }

    throw error;
  }
};

export const validateAuthForm = ({
  email,
  password,
}: {
  readonly email: string;
  readonly password: string;
}): FieldErrors => {
  const errors: FieldErrors = {};

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (password.length < 8) {
    errors.password = "Use at least 8 characters.";
  }

  return errors;
};

export const mapFieldErrors = (
  details: readonly ApiErrorDetail[] | undefined,
): FieldErrors =>
  details?.reduce<FieldErrors>((errors, detail) => {
    if (detail.path === "email" || detail.path === "password") {
      errors[detail.path] = detail.message;
    }

    return errors;
  }, {}) ?? {};

export const useAuthSessionQuery = () =>
  useQuery({
    queryFn: loadAuthSession,
    queryKey: authQueryKey,
    refetchOnMount: "always",
    staleTime: 0,
  });

export const useOnboardingStateQuery = () =>
  useQuery({
    queryFn: loadOnboardingState,
    queryKey: onboardingQueryKey,
    staleTime: 0,
  });
