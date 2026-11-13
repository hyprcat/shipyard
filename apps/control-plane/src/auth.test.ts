import { sessions, teamMemberships, teams, users } from "@shipyard/db";
import * as argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SESSION_TTL_MS, createAuthService } from "./auth";

const createDbMock = () => {
  const returning = vi.fn();
  const values = vi.fn(() => ({
    returning,
  }));
  const insert = vi.fn(() => ({
    values,
  }));
  const limit = vi.fn();
  const where = vi.fn(() => ({
    limit,
  }));
  const innerJoin = vi.fn(() => ({
    where,
  }));
  const from = vi.fn(() => ({
    innerJoin,
    where,
  }));
  const select = vi.fn(() => ({
    from,
  }));
  const updateWhere = vi.fn();
  const set = vi.fn(() => ({
    where: updateWhere,
  }));
  const update = vi.fn(() => ({
    set,
  }));

  return {
    db: {
      insert,
      select,
      update,
    },
    from,
    innerJoin,
    insert,
    limit,
    returning,
    select,
    set,
    update,
    updateWhere,
    values,
    where,
  };
};

const getLastInsertValues = (
  db: ReturnType<typeof createDbMock>,
): Record<string, unknown> => {
  const calls = db.values.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;

  return calls[calls.length - 1][0];
};

const createRegistrationDbMock = (
  options: {
    existingMembership?: { id: string };
    failOnUserInsert?: unknown;
    now?: Date;
  } = {},
) => {
  const operations: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const limit = vi
    .fn()
    .mockResolvedValue(
      options.existingMembership ? [options.existingMembership] : [],
    );
  const transaction = vi.fn(async (callback: (tx: never) => Promise<unknown>) =>
    callback({
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          operations.push({ table, values });

          return {
            returning: async () => {
              if (table === users && options.failOnUserInsert) {
                throw options.failOnUserInsert;
              }

              if (table === users) {
                return [
                  {
                    ...values,
                    createdAt: options.now ?? new Date("2026-03-08T00:00:00Z"),
                    onboardingCompletedAt: null,
                  },
                ];
              }

              if (table === teams) {
                return [
                  {
                    ...values,
                    createdAt: options.now ?? new Date("2026-03-08T00:00:00Z"),
                  },
                ];
              }

              if (table === sessions) {
                return [
                  {
                    ...values,
                    createdAt: options.now ?? new Date("2026-03-08T00:00:00Z"),
                    revokedAt: null,
                  },
                ];
              }

              return [values];
            },
          };
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit,
          }),
        }),
      }),
    } as never),
  );

  return {
    db: {
      transaction,
    },
    limit,
    operations,
    transaction,
  };
};

describe("@shipyard/control-plane auth", () => {
  it("stores an Argon2 password hash instead of plaintext", async () => {
    const db = createDbMock();
    db.returning.mockImplementation(async () => [
      {
        ...getLastInsertValues(db),
        createdAt: new Date("2026-03-08T00:00:00.000Z"),
        onboardingCompletedAt: null,
      },
    ]);

    const service = createAuthService({
      db: db.db as never,
      generateId: () => "user-1",
    });

    const user = await service.createUser({
      email: " Owner@Shipyard.Local ",
      password: "shipyard-secret",
    });

    const insertedUser = (
      db.values.mock.calls as unknown as Array<
        [{ email: string; id: string; passwordHash: string }]
      >
    )[0][0];

    expect(insertedUser.id).toBe("user-1");
    expect(insertedUser.email).toBe("owner@shipyard.local");
    expect(insertedUser.passwordHash).not.toBe("shipyard-secret");
    await expect(
      argon2.verify(insertedUser.passwordHash, "shipyard-secret"),
    ).resolves.toBe(true);
    expect(user.passwordHash).toBe(insertedUser.passwordHash);
  });

  it("returns a typed auth error for duplicate emails", async () => {
    const db = createDbMock();
    db.returning.mockRejectedValue(
      Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "users_email_uidx",
      }),
    );

    const service = createAuthService({
      db: db.db as never,
      generateId: () => "user-1",
    });

    await expect(
      service.createUser({
        email: "owner@shipyard.local",
        password: "shipyard-secret",
      }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_EMAIL",
      name: "AuthError",
      statusCode: 409,
    });
  });

  it("registers a user with an owner team and session in one transaction", async () => {
    const now = new Date("2026-03-08T00:00:00.000Z");
    const db = createRegistrationDbMock({ now });
    const ids = ["user-1", "team-1", "membership-1", "session-1"];

    const service = createAuthService({
      db: db.db as never,
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => now,
    });

    const registration = await service.registerUser({
      email: " Owner@Shipyard.Local ",
      password: "shipyard-secret",
    });

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.limit).toHaveBeenCalledWith(1);
    expect(db.operations).toMatchObject([
      {
        table: users,
        values: {
          id: "user-1",
          email: "owner@shipyard.local",
        },
      },
      {
        table: teams,
        values: {
          id: "team-1",
          billingOwnerUserId: "user-1",
          name: "Owner Team",
          slug: "owner-user1",
        },
      },
      {
        table: teamMemberships,
        values: {
          id: "membership-1",
          teamId: "team-1",
          userId: "user-1",
          role: "owner",
          invitedAt: now,
          acceptedAt: now,
        },
      },
      {
        table: sessions,
        values: {
          id: "session-1",
          userId: "user-1",
          expiresAt: new Date(now.getTime() + DEFAULT_SESSION_TTL_MS),
        },
      },
    ]);
    await expect(
      argon2.verify(
        db.operations[0]!.values.passwordHash as string,
        "shipyard-secret",
      ),
    ).resolves.toBe(true);
    expect(registration.team.id).toBe("team-1");
    expect(registration.session.id).toBe("session-1");
  });

  it("stops registration before team creation when the email already exists", async () => {
    const db = createRegistrationDbMock({
      failOnUserInsert: Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "users_email_uidx",
      }),
    });

    const service = createAuthService({
      db: db.db as never,
      generateId: () => "user-1",
    });

    await expect(
      service.registerUser({
        email: "owner@shipyard.local",
        password: "shipyard-secret",
      }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_EMAIL",
      name: "AuthError",
      statusCode: 409,
    });
    expect(db.operations).toHaveLength(1);
    expect(db.operations[0]?.table).toBe(users);
  });

  it("persists sessions with the default expiry window", async () => {
    const db = createDbMock();
    const now = new Date("2026-03-08T00:00:00.000Z");
    db.returning.mockImplementation(async () => [
      {
        ...getLastInsertValues(db),
        createdAt: now,
        revokedAt: null,
      },
    ]);

    const service = createAuthService({
      db: db.db as never,
      generateId: () => "session-1",
      now: () => now,
    });

    const session = await service.createSession({
      userId: "user-1",
    });

    expect(db.values).toHaveBeenCalledWith({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(now.getTime() + DEFAULT_SESSION_TTL_MS),
    });
    expect(session.id).toBe("session-1");
  });

  it("logs in with valid credentials and creates a fresh session", async () => {
    const db = createDbMock();
    const now = new Date("2026-03-08T00:00:00.000Z");
    db.limit.mockResolvedValue([
      {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: await argon2.hash("shipyard-secret", {
          type: argon2.argon2id,
        }),
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        onboardingCompletedAt: null,
      },
    ]);
    db.returning.mockImplementation(async () => [
      {
        ...getLastInsertValues(db),
        createdAt: now,
        revokedAt: null,
      },
    ]);

    const service = createAuthService({
      db: db.db as never,
      generateId: () => "session-1",
      now: () => now,
    });

    const login = await service.loginUser({
      email: " Owner@Shipyard.Local ",
      password: "shipyard-secret",
    });

    expect(db.from).toHaveBeenCalledWith(users);
    expect(db.values).toHaveBeenCalledWith({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(now.getTime() + DEFAULT_SESSION_TTL_MS),
    });
    expect(login.user.id).toBe("user-1");
    expect(login.session.id).toBe("session-1");
  });

  it("returns the same auth error when a login email does not exist", async () => {
    const db = createDbMock();
    db.limit.mockResolvedValue([]);

    const service = createAuthService({
      db: db.db as never,
    });

    await expect(
      service.loginUser({
        email: "missing@shipyard.local",
        password: "shipyard-secret",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
      name: "AuthError",
      statusCode: 401,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns the same auth error when a login password is wrong", async () => {
    const db = createDbMock();
    db.limit.mockResolvedValue([
      {
        id: "user-1",
        email: "owner@shipyard.local",
        passwordHash: await argon2.hash("correct-password", {
          type: argon2.argon2id,
        }),
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        onboardingCompletedAt: null,
      },
    ]);

    const service = createAuthService({
      db: db.db as never,
    });

    await expect(
      service.loginUser({
        email: "owner@shipyard.local",
        password: "wrong-password",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
      name: "AuthError",
      statusCode: 401,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("treats missing sessions as unauthorized", async () => {
    const db = createDbMock();
    db.limit.mockResolvedValue([]);

    const service = createAuthService({
      db: db.db as never,
    });

    await expect(service.getSession("missing-session")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      message: "Unauthorized",
      name: "AuthError",
      statusCode: 401,
    });
  });

  it("returns a typed auth error for expired sessions without reviving them", async () => {
    const db = createDbMock();
    db.limit.mockResolvedValue([
      {
        sessions: {
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          expiresAt: new Date("2026-03-07T23:59:59.000Z"),
          id: "session-1",
          revokedAt: null,
          userId: "user-1",
        },
        users: {
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          email: "owner@shipyard.local",
          id: "user-1",
          onboardingCompletedAt: null,
          passwordHash: "argon2-hash",
        },
      },
    ]);

    const service = createAuthService({
      db: db.db as never,
      now: () => new Date("2026-03-08T00:00:00.000Z"),
    });

    await expect(service.getSession("session-1")).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
      name: "AuthError",
      statusCode: 401,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("revokes sessions with the current timestamp", async () => {
    const db = createDbMock();
    const now = new Date("2026-03-08T00:00:00.000Z");
    const service = createAuthService({
      db: db.db as never,
      now: () => now,
    });

    await service.revokeSession("session-1");

    expect(db.update).toHaveBeenCalledWith(sessions);
    expect(db.set).toHaveBeenCalledWith({
      revokedAt: now,
    });
    expect(db.updateWhere).toHaveBeenCalledOnce();
  });
});
