import { teamInvitations, teamMemberships } from "@shipyard/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTeamService } from "./team-service";

const createDbMock = ({
  insertResults = [],
  limitResults = [],
  orderByResults = [],
}: {
  insertResults?: unknown[][];
  limitResults?: unknown[][];
  orderByResults?: unknown[][];
} = {}) => {
  const queuedInsertResults = [...insertResults];
  const queuedLimitResults = [...limitResults];
  const queuedOrderByResults = [...orderByResults];
  const insertOperations: Array<{
    table: unknown;
    values: Record<string, unknown>;
  }> = [];
  const updateOperations: Array<{
    table: unknown;
    values: Record<string, unknown>;
  }> = [];

  const limit = vi
    .fn()
    .mockImplementation(async () => queuedLimitResults.shift() ?? []);
  const orderBy = vi
    .fn()
    .mockImplementation(async () => queuedOrderByResults.shift() ?? []);
  const where = vi.fn(() => ({
    limit,
    orderBy,
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
  const returning = vi
    .fn()
    .mockImplementation(async () => queuedInsertResults.shift() ?? []);
  const insert = vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      insertOperations.push({ table, values });

      return {
        returning,
      };
    },
  }));
  const updateWhere = vi.fn().mockResolvedValue([]);
  const update = vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      updateOperations.push({ table, values });

      return {
        where: updateWhere,
      };
    },
  }));

  return {
    db: {
      insert,
      select,
      update,
    },
    insert,
    insertOperations,
    update,
    updateOperations,
  };
};

describe("@shipyard/control-plane team service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists active members and pending invitations for a team member", async () => {
    const now = new Date("2026-03-08T00:00:00.000Z");
    const db = createDbMock({
      limitResults: [
        [{ id: "membership-1", role: "viewer", userId: "user-1" }],
      ],
      orderByResults: [
        [
          {
            email: "ops@shipyard.local",
            expiresAt: new Date("2026-03-09T00:00:00.000Z"),
            id: "invite-1",
            invitedAt: now,
            role: "operator",
          },
        ],
        [
          {
            acceptedAt: now,
            email: "owner@shipyard.local",
            id: "membership-1",
            invitedAt: now,
            role: "owner",
            userId: "user-1",
          },
        ],
      ],
    });

    const service = createTeamService({
      db: db.db as never,
      now: () => now,
    });

    await expect(
      service.listMembers({
        teamId: "team-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      currentUserRole: "viewer",
      invitations: [
        {
          email: "ops@shipyard.local",
          expiresAt: new Date("2026-03-09T00:00:00.000Z"),
          id: "invite-1",
          invitedAt: now,
          role: "operator",
          status: "pending",
        },
      ],
      members: [
        {
          acceptedAt: now,
          email: "owner@shipyard.local",
          id: "membership-1",
          invitedAt: now,
          role: "owner",
          userId: "user-1",
        },
      ],
    });
  });

  it("stores owner-created invitations as pending with normalized email", async () => {
    const now = new Date("2026-03-08T00:00:00.000Z");
    const db = createDbMock({
      insertResults: [
        [
          {
            createdAt: now,
            email: "ops@shipyard.local",
            expiresAt: new Date("2026-03-15T00:00:00.000Z"),
            id: "invite-1",
            invitedAt: now,
            invitedByUserId: "user-1",
            role: "operator",
            teamId: "team-1",
          },
        ],
      ],
      limitResults: [
        [{ id: "membership-1", role: "owner", userId: "user-1" }],
        [],
        [],
      ],
    });

    const service = createTeamService({
      db: db.db as never,
      generateId: () => "invite-1",
      now: () => now,
    });

    await expect(
      service.inviteMember({
        email: " Ops@Shipyard.Local ",
        role: "operator",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      createdAt: now,
      email: "ops@shipyard.local",
      expiresAt: new Date("2026-03-15T00:00:00.000Z"),
      id: "invite-1",
      invitedAt: now,
      invitedByUserId: "user-1",
      role: "operator",
      status: "pending",
      teamId: "team-1",
    });
    expect(db.insert).toHaveBeenCalledWith(teamInvitations);
    expect(db.insertOperations).toEqual([
      {
        table: teamInvitations,
        values: {
          email: "ops@shipyard.local",
          expiresAt: new Date("2026-03-15T00:00:00.000Z"),
          id: "invite-1",
          invitedByUserId: "user-1",
          role: "operator",
          teamId: "team-1",
        },
      },
    ]);
  });

  it("rejects member invites from viewers with a typed authorization error", async () => {
    const db = createDbMock({
      limitResults: [
        [{ id: "membership-1", role: "viewer", userId: "user-1" }],
      ],
    });

    const service = createTeamService({
      db: db.db as never,
    });

    await expect(
      service.inviteMember({
        email: "ops@shipyard.local",
        role: "operator",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "AUTHORIZATION_ERROR",
      name: "TeamServiceError",
      statusCode: 403,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects member invites from outsiders with a typed authorization error", async () => {
    const db = createDbMock({
      limitResults: [[]],
    });

    const service = createTeamService({
      db: db.db as never,
    });

    await expect(
      service.inviteMember({
        email: "ops@shipyard.local",
        role: "operator",
        teamId: "team-1",
        userId: "user-9",
      }),
    ).rejects.toMatchObject({
      code: "AUTHORIZATION_ERROR",
      name: "TeamServiceError",
      statusCode: 403,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("soft removes team members for owners", async () => {
    const now = new Date("2026-03-08T00:00:00.000Z");
    const db = createDbMock({
      limitResults: [
        [{ id: "membership-1", role: "owner", userId: "user-1" }],
        [
          {
            acceptedAt: now,
            email: "viewer@shipyard.local",
            id: "membership-2",
            invitedAt: now,
            role: "viewer",
            userId: "user-2",
          },
        ],
      ],
    });

    const service = createTeamService({
      db: db.db as never,
      now: () => now,
    });

    await expect(
      service.removeMember({
        membershipId: "membership-2",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).resolves.toBeUndefined();
    expect(db.update).toHaveBeenCalledWith(teamMemberships);
    expect(db.updateOperations).toEqual([
      {
        table: teamMemberships,
        values: {
          removedAt: now,
        },
      },
    ]);
  });

  it("updates member roles for owners", async () => {
    const now = new Date("2026-03-08T00:00:00.000Z");
    const db = createDbMock({
      limitResults: [
        [{ id: "membership-1", role: "owner", userId: "user-1" }],
        [
          {
            acceptedAt: now,
            email: "ops@shipyard.local",
            id: "membership-2",
            invitedAt: now,
            role: "operator",
            userId: "user-2",
          },
        ],
      ],
    });

    const service = createTeamService({
      db: db.db as never,
    });

    await expect(
      service.updateMemberRole({
        membershipId: "membership-2",
        role: "admin",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      acceptedAt: now,
      email: "ops@shipyard.local",
      id: "membership-2",
      invitedAt: now,
      role: "admin",
      userId: "user-2",
    });
    expect(db.update).toHaveBeenCalledWith(teamMemberships);
    expect(db.updateOperations).toEqual([
      {
        table: teamMemberships,
        values: {
          role: "admin",
        },
      },
    ]);
  });

  it("fails role updates for unknown memberships", async () => {
    const db = createDbMock({
      limitResults: [
        [{ id: "membership-1", role: "owner", userId: "user-1" }],
        [],
      ],
    });

    const service = createTeamService({
      db: db.db as never,
    });

    await expect(
      service.updateMemberRole({
        membershipId: "membership-missing",
        role: "admin",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "MEMBERSHIP_NOT_FOUND",
      name: "TeamServiceError",
      statusCode: 404,
    });
  });

  it("rejects duplicate pending invitations", async () => {
    const db = createDbMock({
      limitResults: [
        [{ id: "membership-1", role: "owner", userId: "user-1" }],
        [{ id: "invite-1" }],
      ],
    });

    const service = createTeamService({
      db: db.db as never,
    });

    await expect(
      service.inviteMember({
        email: "ops@shipyard.local",
        role: "operator",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "INVITATION_ALREADY_EXISTS",
      name: "TeamServiceError",
      statusCode: 409,
    });
  });

  it("rejects invites for users who are already active members", async () => {
    const db = createDbMock({
      limitResults: [
        [{ id: "membership-1", role: "owner", userId: "user-1" }],
        [],
        [{ id: "membership-2" }],
      ],
    });

    const service = createTeamService({
      db: db.db as never,
    });

    await expect(
      service.inviteMember({
        email: "ops@shipyard.local",
        role: "operator",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "INVITATION_ALREADY_EXISTS",
      message: "User is already a member of this team",
      name: "TeamServiceError",
      statusCode: 409,
    });
  });
});
