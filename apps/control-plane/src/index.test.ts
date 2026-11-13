import { EnvironmentValidationError } from "@shipyard/config";
import { describe, expect, it, vi } from "vitest";

import { buildControlPlane, startControlPlane } from "./index";
import { AuthError } from "./auth";
import { TeamServiceError } from "./team-service";

const validEnv = {
  DATABASE_URL: "postgresql://shipyard:secret@localhost:15432/shipyard",
  REDIS_URL: "redis://localhost:16379/0",
  S3_ENDPOINT: "http://localhost:19000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "shipyard-local",
  S3_ACCESS_KEY_ID: "shipyard",
  S3_SECRET_ACCESS_KEY: "shipyard-dev-minio",
  S3_FORCE_PATH_STYLE: "true",
} satisfies Record<string, string>;

describe("@shipyard/control-plane", () => {
  it("binds only after configuration is valid", async () => {
    const bindPort = vi.fn();

    const { app, env } = await startControlPlane(validEnv, bindPort);

    expect(env.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(bindPort).toHaveBeenCalledOnce();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/health",
        })
      ).json(),
    ).toEqual({
      ok: true,
      service: "control-plane",
    });
    await app.close();
  });

  it("aborts startup before binding when env is invalid", async () => {
    const bindPort = vi.fn();

    await expect(
      startControlPlane(
        {
          ...validEnv,
          REDIS_URL: undefined,
        },
        bindPort,
      ),
    ).rejects.toThrowError(EnvironmentValidationError);
    expect(bindPort).not.toHaveBeenCalled();
  });

  it("validates requests and exposes parsed cookies", async () => {
    const { app } = buildControlPlane(validEnv);
    const response = await app.inject({
      method: "GET",
      url: "/echo?message=shipyard",
      headers: {
        cookie: "session=abc123",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      ok: true,
      message: "shipyard",
      session: "abc123",
    });
    await app.close();
  });

  it("returns structured json for validation failures", async () => {
    const { app } = buildControlPlane(validEnv);
    const response = await app.inject({
      method: "GET",
      url: "/echo",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        statusCode: 400,
        details: [
          {
            message: "must have required property 'message'",
            path: "message",
          },
        ],
      },
    });
    await app.close();
  });

  it("registers a user and returns a session cookie", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const registerUser = vi.fn().mockResolvedValue({
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
      team: {
        id: "team-1",
        name: "Owner Team",
        slug: "owner-user1",
        billingOwnerUserId: "user-1",
        createdAt,
      },
      session: {
        id: "session-1",
        userId: "user-1",
        expiresAt,
        createdAt,
        revokedAt: null,
      },
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        registerUser,
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "owner@shipyard.local",
        password: "shipyard-secret",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      ok: true,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        createdAt: createdAt.toISOString(),
        onboardingCompletedAt: null,
      },
      session: {
        id: "session-1",
        userId: "user-1",
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
    expect(response.headers["set-cookie"]).toContain("session=session-1");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(registerUser).toHaveBeenCalledWith({
      email: "owner@shipyard.local",
      password: "shipyard-secret",
    });
    await app.close();
  });

  it("logs in a user and issues a secure session cookie over https", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const loginUser = vi.fn().mockResolvedValue({
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
      session: {
        id: "session-1",
        userId: "user-1",
        expiresAt,
        createdAt,
        revokedAt: null,
      },
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        loginUser,
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        "x-forwarded-proto": "https",
      },
      payload: {
        email: "owner@shipyard.local",
        password: "shipyard-secret",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        createdAt: createdAt.toISOString(),
        onboardingCompletedAt: null,
      },
      session: {
        id: "session-1",
        userId: "user-1",
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
    expect(response.headers["set-cookie"]).toContain("session=session-1");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(loginUser).toHaveBeenCalledWith({
      email: "owner@shipyard.local",
      password: "shipyard-secret",
    });
    await app.close();
  });

  it("rejects invalid login credentials with a generic unauthorized response", async () => {
    const { app } = buildControlPlane(validEnv, {
      authService: {
        loginUser: vi
          .fn()
          .mockRejectedValue(
            new AuthError(
              "INVALID_CREDENTIALS",
              "Invalid email or password",
              401,
            ),
          ),
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "owner@shipyard.local",
        password: "shipyard-secret",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "REQUEST_ERROR",
        message: "Invalid email or password",
        statusCode: 401,
      },
    });
    await app.close();
  });

  it("returns the current authenticated session", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: "session=session-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        createdAt: createdAt.toISOString(),
        onboardingCompletedAt: null,
      },
      session: {
        id: "session-1",
        userId: "user-1",
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
    expect(getSession).toHaveBeenCalledWith("session-1");
    await app.close();
  });

  it("rejects current-session inspection when no session cookie is present", async () => {
    const getSession = vi.fn();
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "REQUEST_ERROR",
        message: "Unauthorized",
        statusCode: 401,
      },
    });
    expect(getSession).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects expired sessions from current-session inspection", async () => {
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession: vi
          .fn()
          .mockRejectedValue(
            new AuthError("SESSION_EXPIRED", "Unauthorized", 401),
          ),
      } as never,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: "session=session-1",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "REQUEST_ERROR",
        message: "Unauthorized",
        statusCode: 401,
      },
    });
    await app.close();
  });

  it("logs out an authenticated session and clears the cookie", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const revokeSession = vi.fn();
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
        revokeSession,
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: "session=session-1",
        "x-forwarded-proto": "https",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
    });
    expect(getSession).toHaveBeenCalledWith("session-1");
    expect(revokeSession).toHaveBeenCalledWith("session-1");
    expect(response.headers["set-cookie"]).toContain("session=");
    expect(response.headers["set-cookie"]).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Secure");
    await app.close();
  });

  it("rejects an invalid registration email before creating anything", async () => {
    const registerUser = vi.fn();
    const { app } = buildControlPlane(validEnv, {
      authService: {
        registerUser,
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "not-an-email",
        password: "shipyard-secret",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        statusCode: 400,
        details: [
          {
            message: 'must match pattern "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"',
            path: "email",
          },
        ],
      },
    });
    expect(registerUser).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a weak registration password before creating anything", async () => {
    const registerUser = vi.fn();
    const { app } = buildControlPlane(validEnv, {
      authService: {
        registerUser,
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "owner@shipyard.local",
        password: "short",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        statusCode: 400,
        details: [
          {
            message: "must NOT have fewer than 8 characters",
            path: "password",
          },
        ],
      },
    });
    expect(registerUser).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps duplicate registration to a validation response", async () => {
    const { app } = buildControlPlane(validEnv, {
      authService: {
        registerUser: vi
          .fn()
          .mockRejectedValue(
            new AuthError(
              "DUPLICATE_EMAIL",
              "A user with that email already exists",
              409,
            ),
          ),
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "owner@shipyard.local",
        password: "shipyard-secret",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        statusCode: 409,
        details: [
          {
            message: "A user with that email already exists",
            path: "email",
          },
        ],
      },
    });
    await app.close();
  });

  it("lists team members for the authenticated user", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const listMembers = vi.fn().mockResolvedValue({
      currentUserRole: "owner",
      invitations: [
        {
          email: "ops@shipyard.local",
          expiresAt: new Date("2026-03-15T00:00:00.000Z"),
          id: "invite-1",
          invitedAt: createdAt,
          role: "operator",
          status: "pending",
        },
      ],
      members: [
        {
          acceptedAt: createdAt,
          email: "owner@shipyard.local",
          id: "membership-1",
          invitedAt: createdAt,
          role: "owner",
          userId: "user-1",
        },
      ],
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
      teamService: {
        listMembers,
      } as never,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/teams/team-1/members",
      headers: {
        cookie: "session=session-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currentUserRole: "owner",
      invitations: [
        {
          email: "ops@shipyard.local",
          expiresAt: "2026-03-15T00:00:00.000Z",
          id: "invite-1",
          invitedAt: "2026-03-08T00:00:00.000Z",
          role: "operator",
          status: "pending",
        },
      ],
      members: [
        {
          acceptedAt: "2026-03-08T00:00:00.000Z",
          email: "owner@shipyard.local",
          id: "membership-1",
          invitedAt: "2026-03-08T00:00:00.000Z",
          role: "owner",
          userId: "user-1",
        },
      ],
      ok: true,
    });
    expect(listMembers).toHaveBeenCalledWith({
      teamId: "team-1",
      userId: "user-1",
    });
    await app.close();
  });

  it("creates pending team invitations for authorized owners", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const inviteMember = vi.fn().mockResolvedValue({
      email: "ops@shipyard.local",
      expiresAt: new Date("2026-03-15T00:00:00.000Z"),
      id: "invite-1",
      invitedAt: createdAt,
      role: "operator",
      status: "pending",
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
      teamService: {
        inviteMember,
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/teams/team-1/members/invitations",
      headers: {
        cookie: "session=session-1",
      },
      payload: {
        email: "ops@shipyard.local",
        role: "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      invitation: {
        email: "ops@shipyard.local",
        expiresAt: "2026-03-15T00:00:00.000Z",
        id: "invite-1",
        invitedAt: "2026-03-08T00:00:00.000Z",
        role: "operator",
        status: "pending",
      },
      ok: true,
    });
    expect(inviteMember).toHaveBeenCalledWith({
      email: "ops@shipyard.local",
      role: "operator",
      teamId: "team-1",
      userId: "user-1",
    });
    await app.close();
  });

  it("updates team member roles for authorized owners", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const updateMemberRole = vi.fn().mockResolvedValue({
      acceptedAt: createdAt,
      email: "ops@shipyard.local",
      id: "membership-2",
      invitedAt: createdAt,
      role: "admin",
      userId: "user-2",
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
      teamService: {
        updateMemberRole,
      } as never,
    });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/teams/team-1/members/membership-2",
      headers: {
        cookie: "session=session-1",
      },
      payload: {
        role: "admin",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      member: {
        acceptedAt: "2026-03-08T00:00:00.000Z",
        email: "ops@shipyard.local",
        id: "membership-2",
        invitedAt: "2026-03-08T00:00:00.000Z",
        role: "admin",
        userId: "user-2",
      },
      ok: true,
    });
    expect(updateMemberRole).toHaveBeenCalledWith({
      membershipId: "membership-2",
      role: "admin",
      teamId: "team-1",
      userId: "user-1",
    });
    await app.close();
  });

  it("removes team members for authorized owners", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const removeMember = vi.fn();
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
      teamService: {
        removeMember,
      } as never,
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/teams/team-1/members/membership-2",
      headers: {
        cookie: "session=session-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
    });
    expect(removeMember).toHaveBeenCalledWith({
      membershipId: "membership-2",
      teamId: "team-1",
      userId: "user-1",
    });
    await app.close();
  });

  it("returns a typed authorization error when viewers try to invite members", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-3",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-3",
        email: "viewer@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
      teamService: {
        inviteMember: vi
          .fn()
          .mockRejectedValue(
            new TeamServiceError("AUTHORIZATION_ERROR", "Forbidden", 403),
          ),
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/teams/team-1/members/invitations",
      headers: {
        cookie: "session=session-1",
      },
      payload: {
        email: "ops@shipyard.local",
        role: "operator",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "AUTHORIZATION_ERROR",
        message: "Forbidden",
        statusCode: 403,
      },
    });
    await app.close();
  });

  it("returns the current onboarding state for the authenticated user", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const onboardingTeamConfirmedAt = new Date("2026-03-08T01:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const getState = vi.fn().mockResolvedValue({
      apiKeyCount: 1,
      firstIncompleteStep: "project",
      onboardingCompletedAt: null,
      onboardingTeamConfirmedAt,
      projectCount: 0,
      team: {
        id: "team-1",
        name: "Owner Team",
        slug: "owner-user1",
      },
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
      onboardingService: {
        getState,
      } as never,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/onboarding",
      headers: {
        cookie: "session=session-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      state: {
        apiKeyCount: 1,
        firstIncompleteStep: "project",
        onboardingCompletedAt: null,
        onboardingTeamConfirmedAt: onboardingTeamConfirmedAt.toISOString(),
        projectCount: 0,
        team: {
          id: "team-1",
          name: "Owner Team",
          slug: "owner-user1",
        },
      },
    });
    expect(getState).toHaveBeenCalledWith({
      userId: "user-1",
    });
    await app.close();
  });

  it("creates an onboarding API key for the authenticated user", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const onboardingTeamConfirmedAt = new Date("2026-03-08T01:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const createApiKey = vi.fn().mockResolvedValue({
      apiKey: {
        id: "key-1",
        label: "Local CLI",
        prefix: "sy_abcd1234",
        secret: "sy_abcd1234_example",
      },
      state: {
        apiKeyCount: 1,
        firstIncompleteStep: "project",
        onboardingCompletedAt: null,
        onboardingTeamConfirmedAt,
        projectCount: 0,
        team: {
          id: "team-1",
          name: "Owner Team",
          slug: "owner-user1",
        },
      },
    });
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
      onboardingService: {
        createApiKey,
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/onboarding/api-keys",
      headers: {
        cookie: "session=session-1",
      },
      payload: {
        label: "Local CLI",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      apiKey: {
        id: "key-1",
        label: "Local CLI",
        prefix: "sy_abcd1234",
        secret: "sy_abcd1234_example",
      },
      ok: true,
      state: {
        apiKeyCount: 1,
        firstIncompleteStep: "project",
        onboardingCompletedAt: null,
        onboardingTeamConfirmedAt: onboardingTeamConfirmedAt.toISOString(),
        projectCount: 0,
        team: {
          id: "team-1",
          name: "Owner Team",
          slug: "owner-user1",
        },
      },
    });
    expect(createApiKey).toHaveBeenCalledWith({
      label: "Local CLI",
      userId: "user-1",
    });
    await app.close();
  });

  it("creates the first onboarding project and lists projects afterward", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    const expiresAt = new Date("2026-04-07T00:00:00.000Z");
    const onboardingCompletedAt = new Date("2026-03-08T02:00:00.000Z");
    const onboardingTeamConfirmedAt = new Date("2026-03-08T01:00:00.000Z");
    const getSession = vi.fn().mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      createdAt,
      expiresAt,
      revokedAt: null,
      user: {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: "argon2-hash",
        onboardingCompletedAt: null,
        createdAt,
      },
    });
    const createProject = vi.fn().mockResolvedValue({
      project: {
        createdAt,
        id: "project-1",
        name: "Shipyard Demo",
        slug: "shipyard-demo",
      },
      state: {
        apiKeyCount: 1,
        firstIncompleteStep: "complete",
        onboardingCompletedAt,
        onboardingTeamConfirmedAt,
        projectCount: 1,
        team: {
          id: "team-1",
          name: "Owner Team",
          slug: "owner-user1",
        },
      },
    });
    const listProjects = vi.fn().mockResolvedValue([
      {
        createdAt,
        id: "project-1",
        name: "Shipyard Demo",
        slug: "shipyard-demo",
      },
    ]);
    const { app } = buildControlPlane(validEnv, {
      authService: {
        getSession,
      } as never,
      onboardingService: {
        createProject,
        listProjects,
      } as never,
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/onboarding/projects",
      headers: {
        cookie: "session=session-1",
      },
      payload: {
        name: "Shipyard Demo",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toEqual({
      ok: true,
      project: {
        createdAt: createdAt.toISOString(),
        id: "project-1",
        name: "Shipyard Demo",
        slug: "shipyard-demo",
      },
      state: {
        apiKeyCount: 1,
        firstIncompleteStep: "complete",
        onboardingCompletedAt: onboardingCompletedAt.toISOString(),
        onboardingTeamConfirmedAt: onboardingTeamConfirmedAt.toISOString(),
        projectCount: 1,
        team: {
          id: "team-1",
          name: "Owner Team",
          slug: "owner-user1",
        },
      },
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: {
        cookie: "session=session-1",
      },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      ok: true,
      projects: [
        {
          createdAt: createdAt.toISOString(),
          id: "project-1",
          name: "Shipyard Demo",
          slug: "shipyard-demo",
        },
      ],
    });
    expect(createProject).toHaveBeenCalledWith({
      name: "Shipyard Demo",
      userId: "user-1",
    });
    expect(listProjects).toHaveBeenCalledWith({
      userId: "user-1",
    });
    await app.close();
  });

  it("returns structured json for runtime failures", async () => {
    const { app } = buildControlPlane(validEnv);
    app.get("/boom", async () => {
      throw new Error("boom");
    });
    const response = await app.inject({
      method: "GET",
      url: "/boom",
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error",
        statusCode: 500,
      },
    });
    await app.close();
  });
});
