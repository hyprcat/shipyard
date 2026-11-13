import {
  type FastifyPluginAsync,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  AuthError,
  type AuthService,
  type AuthSession,
  type AuthUser,
} from "./auth";
import { type ApiKeyService } from "./api-key-service";
import { type OnboardingService } from "./onboarding-service";
import { type TeamService } from "./team-service";
import {
  type AuthenticatedResponse,
  type CurrentSessionResponse,
  type EchoQuerystring,
  type EchoResponse,
  type HealthResponse,
  type InviteMemberRequestBody,
  type LoginResponse,
  type LogoutResponse,
  type OnboardingApiKeyRequestBody,
  type OnboardingApiKeyResponse,
  type OnboardingProjectRequestBody,
  type OnboardingProjectResponse,
  type OnboardingState,
  type OnboardingStateResponse,
  type OnboardingTeamRequestBody,
  type ProjectsResponse,
  type RegisterRequestBody,
  type RegisterResponse,
  type TeamInvitationResponse,
  type TeamMemberParams,
  type TeamMemberResponse,
  type TeamMembersResponse,
  type TeamParams,
  type UpdateTeamMemberRoleRequestBody,
  authenticatedResponseSchema,
  echoQuerystringSchema,
  echoResponseSchema,
  healthResponseSchema,
  inviteMemberBodySchema,
  logoutResponseSchema,
  onboardingApiKeyBodySchema,
  onboardingApiKeyResponseSchema,
  onboardingProjectBodySchema,
  onboardingProjectResponseSchema,
  onboardingStateResponseSchema,
  onboardingTeamBodySchema,
  projectsResponseSchema,
  registerBodySchema,
  teamMemberParamsSchema,
  teamParamsSchema,
  updateTeamMemberRoleBodySchema,
} from "./schemas";

interface RouteServices {
  apiKeyService: ApiKeyService;
  authService: AuthService;
  onboardingService: OnboardingService;
  teamService: TeamService;
}

const sessionCookieName = "session";
const clearedSessionExpiresAt = new Date(0);

const isSecureRequest = (request: FastifyRequest): boolean => {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const normalizedForwardedProto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;

  return (
    request.protocol === "https" ||
    normalizedForwardedProto?.split(",")[0]?.trim() === "https"
  );
};

const buildSessionCookieOptions = (request: FastifyRequest, expires: Date) => ({
  expires,
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: isSecureRequest(request),
});

const setSessionCookie = (
  reply: FastifyReply,
  request: FastifyRequest,
  session: Pick<AuthSession, "expiresAt" | "id">,
): void => {
  reply.setCookie(
    sessionCookieName,
    session.id,
    buildSessionCookieOptions(request, session.expiresAt),
  );
};

const clearSessionCookie = (
  reply: FastifyReply,
  request: FastifyRequest,
): void => {
  reply.setCookie(sessionCookieName, "", {
    ...buildSessionCookieOptions(request, clearedSessionExpiresAt),
    maxAge: 0,
  });
};

const requireSessionId = (request: FastifyRequest): string => {
  const sessionId = request.cookies.session;

  if (!sessionId) {
    throw new AuthError("SESSION_NOT_FOUND", "Unauthorized", 401);
  }

  return sessionId;
};

const extractBearerToken = (request: FastifyRequest): string | null => {
  const authorization = request.headers.authorization;

  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    throw new AuthError("API_KEY_INVALID", "Unauthorized", 401);
  }

  return match[1];
};

const resolveProjectsAccess = async ({
  apiKeyService,
  authService,
  request,
}: {
  apiKeyService: ApiKeyService;
  authService: AuthService;
  request: FastifyRequest;
}): Promise<
  | {
      kind: "apiKey";
      teamId: string;
    }
  | {
      kind: "session";
      userId: string;
    }
> => {
  const token = extractBearerToken(request);

  if (token !== null) {
    const apiKey = await apiKeyService.authenticateApiKey(token);

    if (!apiKey.teamId) {
      throw new AuthError("API_KEY_INVALID", "Unauthorized", 401);
    }

    return {
      kind: "apiKey",
      teamId: apiKey.teamId,
    };
  }

  const currentSession = await authService.getSession(
    requireSessionId(request),
  );

  return {
    kind: "session",
    userId: currentSession.user.id,
  };
};

const serializeAuthenticatedResponse = ({
  session,
  user,
}: {
  session: Pick<AuthSession, "createdAt" | "expiresAt" | "id" | "userId">;
  user: Pick<AuthUser, "createdAt" | "email" | "id" | "onboardingCompletedAt">;
}): AuthenticatedResponse => ({
  ok: true,
  user: {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    onboardingCompletedAt: user.onboardingCompletedAt,
  },
  session: {
    id: session.id,
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  },
});

const serializeOnboardingState = (state: OnboardingState): OnboardingState => ({
  ...state,
  team: {
    ...state.team,
  },
});

export const routes =
  ({
    apiKeyService,
    authService,
    onboardingService,
    teamService,
  }: RouteServices): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Reply: HealthResponse }>(
      "/health",
      {
        schema: {
          response: {
            200: healthResponseSchema,
          },
        },
      },
      async () => ({
        ok: true,
        service: "control-plane",
      }),
    );

    app.get<{ Querystring: EchoQuerystring; Reply: EchoResponse }>(
      "/echo",
      {
        schema: {
          querystring: echoQuerystringSchema,
          response: {
            200: echoResponseSchema,
          },
        },
      },
      async (request) => ({
        ok: true,
        message: request.query.message,
        session: request.cookies.session ?? null,
      }),
    );

    app.post<{ Body: RegisterRequestBody; Reply: RegisterResponse }>(
      "/api/auth/register",
      {
        schema: {
          body: registerBodySchema,
          response: {
            201: authenticatedResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { session, user } = await authService.registerUser(request.body);

        setSessionCookie(reply, request, session);
        reply.status(201);

        return serializeAuthenticatedResponse({
          session,
          user,
        });
      },
    );

    app.post<{ Body: RegisterRequestBody; Reply: LoginResponse }>(
      "/api/auth/login",
      {
        schema: {
          body: registerBodySchema,
          response: {
            200: authenticatedResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { session, user } = await authService.loginUser(request.body);

        setSessionCookie(reply, request, session);

        return serializeAuthenticatedResponse({
          session,
          user,
        });
      },
    );

    app.post<{ Reply: LogoutResponse }>(
      "/api/auth/logout",
      {
        schema: {
          response: {
            200: logoutResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const sessionId = requireSessionId(request);

        await authService.getSession(sessionId);
        await authService.revokeSession(sessionId);
        clearSessionCookie(reply, request);

        return {
          ok: true,
        };
      },
    );

    app.get<{ Reply: CurrentSessionResponse }>(
      "/api/auth/me",
      {
        schema: {
          response: {
            200: authenticatedResponseSchema,
          },
        },
      },
      async (request) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );

        return serializeAuthenticatedResponse({
          session: currentSession,
          user: currentSession.user,
        });
      },
    );

    app.get<{ Reply: OnboardingStateResponse }>(
      "/api/onboarding",
      {
        schema: {
          response: {
            200: onboardingStateResponseSchema,
          },
        },
      },
      async (request) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );
        const state = await onboardingService.getState({
          userId: currentSession.user.id,
        });

        return {
          ok: true,
          state: serializeOnboardingState(state),
        };
      },
    );

    app.post<{
      Body: OnboardingTeamRequestBody;
      Reply: OnboardingStateResponse;
    }>(
      "/api/onboarding/team",
      {
        schema: {
          body: onboardingTeamBodySchema,
          response: {
            200: onboardingStateResponseSchema,
          },
        },
      },
      async (request) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );
        const state = await onboardingService.confirmTeam({
          name: request.body.name,
          userId: currentSession.user.id,
        });

        return {
          ok: true,
          state: serializeOnboardingState(state),
        };
      },
    );

    app.post<{
      Body: OnboardingApiKeyRequestBody;
      Reply: OnboardingApiKeyResponse;
    }>(
      "/api/onboarding/api-keys",
      {
        schema: {
          body: onboardingApiKeyBodySchema,
          response: {
            200: onboardingApiKeyResponseSchema,
          },
        },
      },
      async (request) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );
        const result = await onboardingService.createApiKey({
          label: request.body.label,
          userId: currentSession.user.id,
        });

        return {
          apiKey: result.apiKey,
          ok: true,
          state: serializeOnboardingState(result.state),
        };
      },
    );

    app.post<{
      Body: OnboardingProjectRequestBody;
      Reply: OnboardingProjectResponse;
    }>(
      "/api/onboarding/projects",
      {
        schema: {
          body: onboardingProjectBodySchema,
          response: {
            201: onboardingProjectResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );
        const result = await onboardingService.createProject({
          name: request.body.name,
          userId: currentSession.user.id,
        });

        reply.status(201);

        return {
          ok: true,
          project: result.project,
          state: serializeOnboardingState(result.state),
        };
      },
    );

    app.get<{ Reply: ProjectsResponse }>(
      "/api/projects",
      {
        schema: {
          response: {
            200: projectsResponseSchema,
          },
        },
      },
      async (request) => {
        const access = await resolveProjectsAccess({
          apiKeyService,
          authService,
          request,
        });
        const projects =
          access.kind === "apiKey"
            ? await onboardingService.listProjectsByTeam({
                teamId: access.teamId,
              })
            : await onboardingService.listProjects({
                userId: access.userId,
              });

        return {
          ok: true,
          projects,
        };
      },
    );

    app.get<{ Params: TeamParams; Reply: TeamMembersResponse }>(
      "/api/teams/:teamId/members",
      {
        schema: {
          params: teamParamsSchema,
        },
      },
      async (request) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );
        const roster = await teamService.listMembers({
          teamId: request.params.teamId,
          userId: currentSession.user.id,
        });

        return {
          ok: true,
          ...roster,
        };
      },
    );

    app.post<{
      Body: InviteMemberRequestBody;
      Params: TeamParams;
      Reply: TeamInvitationResponse;
    }>(
      "/api/teams/:teamId/members/invitations",
      {
        schema: {
          body: inviteMemberBodySchema,
          params: teamParamsSchema,
        },
      },
      async (request, reply) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );
        const invitation = await teamService.inviteMember({
          email: request.body.email,
          role: request.body.role,
          teamId: request.params.teamId,
          userId: currentSession.user.id,
        });

        reply.status(201);

        return {
          ok: true,
          invitation,
        };
      },
    );

    app.patch<{
      Body: UpdateTeamMemberRoleRequestBody;
      Params: TeamMemberParams;
      Reply: TeamMemberResponse;
    }>(
      "/api/teams/:teamId/members/:membershipId",
      {
        schema: {
          body: updateTeamMemberRoleBodySchema,
          params: teamMemberParamsSchema,
        },
      },
      async (request) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );
        const member = await teamService.updateMemberRole({
          membershipId: request.params.membershipId,
          role: request.body.role,
          teamId: request.params.teamId,
          userId: currentSession.user.id,
        });

        return {
          member,
          ok: true,
        };
      },
    );

    app.delete<{ Params: TeamMemberParams; Reply: LogoutResponse }>(
      "/api/teams/:teamId/members/:membershipId",
      {
        schema: {
          params: teamMemberParamsSchema,
          response: {
            200: logoutResponseSchema,
          },
        },
      },
      async (request) => {
        const currentSession = await authService.getSession(
          requireSessionId(request),
        );

        await teamService.removeMember({
          membershipId: request.params.membershipId,
          teamId: request.params.teamId,
          userId: currentSession.user.id,
        });

        return {
          ok: true,
        };
      },
    );
  };
