import { projects, teams, users } from "@shipyard/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOnboardingService,
  resolveFirstIncompleteStep,
} from "./onboarding-service";

const createDbMock = ({
  insertResults = [],
  limitResults = [],
  orderByResults = [],
  whereResults = [],
}: {
  insertResults?: unknown[][];
  limitResults?: unknown[][];
  orderByResults?: unknown[][];
  whereResults?: unknown[][];
} = {}) => {
  const queuedInsertResults = [...insertResults];
  const queuedLimitResults = [...limitResults];
  const queuedOrderByResults = [...orderByResults];
  const queuedWhereResults = [...whereResults];
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
  const orderBy = vi.fn(() => ({
    limit,
    then: (resolve: (value: unknown[]) => void) =>
      resolve(queuedOrderByResults.shift() ?? []),
  }));
  const where = vi.fn(() => ({
    limit,
    orderBy,
    then: (resolve: (value: unknown[]) => void) =>
      resolve(queuedWhereResults.shift() ?? []),
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
    insertOperations,
    updateOperations,
  };
};

describe("@shipyard/control-plane onboarding service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the first incomplete onboarding step from persisted state", () => {
    expect(
      resolveFirstIncompleteStep({
        apiKeyCount: 0,
        onboardingTeamConfirmedAt: null,
        projectCount: 0,
      }),
    ).toBe("team");
    expect(
      resolveFirstIncompleteStep({
        apiKeyCount: 0,
        onboardingTeamConfirmedAt: new Date("2026-03-08T00:00:00.000Z"),
        projectCount: 0,
      }),
    ).toBe("apiKey");
    expect(
      resolveFirstIncompleteStep({
        apiKeyCount: 1,
        onboardingTeamConfirmedAt: new Date("2026-03-08T00:00:00.000Z"),
        projectCount: 0,
      }),
    ).toBe("project");
    expect(
      resolveFirstIncompleteStep({
        apiKeyCount: 1,
        onboardingTeamConfirmedAt: new Date("2026-03-08T00:00:00.000Z"),
        projectCount: 1,
      }),
    ).toBe("complete");
  });

  it("confirms the default team and advances onboarding to API key creation", async () => {
    const now = new Date("2026-03-09T00:00:00.000Z");
    const db = createDbMock({
      limitResults: [
        [{ id: "team-1", name: "Owner Team", slug: "owner-user1" }],
        [{ id: "team-1", name: "Owner Workspace", slug: "owner-user1" }],
        [
          {
            onboardingCompletedAt: null,
            onboardingTeamConfirmedAt: now,
          },
        ],
      ],
      whereResults: [[{ value: 0 }], [{ value: 0 }]],
    });
    const service = createOnboardingService({
      db: db.db as never,
      now: () => now,
    });

    const state = await service.confirmTeam({
      name: "  Owner Workspace  ",
      userId: "user-1",
    });

    expect(state.firstIncompleteStep).toBe("apiKey");
    expect(state.team.name).toBe("Owner Workspace");
    expect(db.updateOperations).toEqual([
      {
        table: teams,
        values: {
          name: "Owner Workspace",
        },
      },
      {
        table: users,
        values: {
          onboardingTeamConfirmedAt: now,
        },
      },
    ]);
  });

  it("creates the first API key and advances onboarding to the project step", async () => {
    const createTeamApiKey = vi.fn().mockResolvedValue({
      id: "key-1",
      isBootstrapSuperuser: false,
      label: "Local CLI",
      prefix: "sy_abcd1234",
      secret: "sy_abcd1234_example",
      teamId: "team-1",
    });
    const db = createDbMock({
      limitResults: [
        [{ id: "team-1", name: "Owner Team", slug: "owner-user1" }],
        [
          {
            onboardingCompletedAt: null,
            onboardingTeamConfirmedAt: new Date("2026-03-08T00:00:00.000Z"),
          },
        ],
        [{ id: "team-1", name: "Owner Team", slug: "owner-user1" }],
        [
          {
            onboardingCompletedAt: null,
            onboardingTeamConfirmedAt: new Date("2026-03-08T00:00:00.000Z"),
          },
        ],
      ],
      whereResults: [
        [{ value: 0 }],
        [{ value: 0 }],
        [{ value: 1 }],
        [{ value: 0 }],
      ],
    });
    const service = createOnboardingService({
      apiKeyService: {
        createTeamApiKey,
      } as never,
      db: db.db as never,
    });

    const result = await service.createApiKey({
      label: " Local CLI ",
      userId: "user-1",
    });

    expect(result.state.firstIncompleteStep).toBe("project");
    expect(result.apiKey).toEqual({
      id: "key-1",
      label: "Local CLI",
      prefix: "sy_abcd1234",
      secret: "sy_abcd1234_example",
    });
    expect(createTeamApiKey).toHaveBeenCalledWith({
      createdByUserId: "user-1",
      label: " Local CLI ",
      teamId: "team-1",
    });
  });

  it("creates the first project and marks onboarding complete", async () => {
    const now = new Date("2026-03-09T00:00:00.000Z");
    const db = createDbMock({
      insertResults: [
        [
          {
            createdAt: now,
            id: "project-1",
            name: "Shipyard Demo",
            slug: "shipyard-demo",
          },
        ],
      ],
      limitResults: [
        [{ id: "team-1", name: "Owner Team", slug: "owner-user1" }],
        [
          {
            onboardingCompletedAt: null,
            onboardingTeamConfirmedAt: new Date("2026-03-08T00:00:00.000Z"),
          },
        ],
        [{ id: "team-1", name: "Owner Team", slug: "owner-user1" }],
        [
          {
            onboardingCompletedAt: now,
            onboardingTeamConfirmedAt: new Date("2026-03-08T00:00:00.000Z"),
          },
        ],
      ],
      whereResults: [
        [{ value: 1 }],
        [{ value: 0 }],
        [{ value: 1 }],
        [{ value: 1 }],
      ],
    });
    const service = createOnboardingService({
      db: db.db as never,
      generateId: () => "project-1",
      now: () => now,
    });

    const result = await service.createProject({
      name: "Shipyard Demo",
      userId: "user-1",
    });

    expect(result.project).toEqual({
      createdAt: now,
      id: "project-1",
      name: "Shipyard Demo",
      slug: "shipyard-demo",
    });
    expect(result.state.firstIncompleteStep).toBe("complete");
    expect(db.insertOperations).toEqual([
      {
        table: projects,
        values: {
          id: "project-1",
          name: "Shipyard Demo",
          slug: "shipyard-demo",
          teamId: "team-1",
        },
      },
    ]);
    expect(db.updateOperations).toContainEqual({
      table: users,
      values: {
        onboardingCompletedAt: now,
      },
    });
  });
});
