import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTeamMembership } from "./team-memberships";

const createDbMock = (existingMembership?: { id: string }) => {
  const returning = vi.fn().mockResolvedValue([
    {
      acceptedAt: new Date("2026-03-08T00:00:00.000Z"),
      id: "membership-1",
      invitedAt: new Date("2026-03-08T00:00:00.000Z"),
      invitedByUserId: "user-2",
      removedAt: null,
      role: "owner",
      teamId: "team-1",
      userId: "user-1",
    },
  ]);
  const values = vi.fn(() => ({
    returning,
  }));
  const insert = vi.fn(() => ({
    values,
  }));
  const limit = vi
    .fn()
    .mockResolvedValue(existingMembership ? [existingMembership] : []);
  const where = vi.fn(() => ({
    limit,
  }));
  const from = vi.fn(() => ({
    where,
  }));
  const select = vi.fn(() => ({
    from,
  }));

  return {
    db: {
      insert,
      select,
    },
    from,
    insert,
    limit,
    returning,
    select,
    values,
    where,
  };
};

describe("@shipyard/db team memberships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists a membership after checking for an existing team/user pair", async () => {
    const db = createDbMock();
    const invitedAt = new Date("2026-03-08T00:00:00.000Z");
    const acceptedAt = new Date("2026-03-08T00:00:00.000Z");

    const membership = await createTeamMembership(db.db as never, {
      acceptedAt,
      id: "membership-1",
      invitedAt,
      invitedByUserId: "user-2",
      role: "owner",
      teamId: "team-1",
      userId: "user-1",
    });

    expect(db.limit).toHaveBeenCalledWith(1);
    expect(db.values).toHaveBeenCalledWith({
      acceptedAt,
      id: "membership-1",
      invitedAt,
      invitedByUserId: "user-2",
      role: "owner",
      teamId: "team-1",
      userId: "user-1",
    });
    expect(membership.id).toBe("membership-1");
  });

  it("rejects an invalid role before querying or inserting", async () => {
    const db = createDbMock();

    await expect(
      createTeamMembership(db.db as never, {
        id: "membership-1",
        role: "super-admin",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ROLE",
      name: "TeamPersistenceError",
      statusCode: 400,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects a duplicate team membership before inserting", async () => {
    const db = createDbMock({ id: "membership-existing" });

    await expect(
      createTeamMembership(db.db as never, {
        id: "membership-1",
        role: "viewer",
        teamId: "team-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_MEMBERSHIP",
      name: "TeamPersistenceError",
      statusCode: 409,
    });
    expect(db.select).toHaveBeenCalledOnce();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
