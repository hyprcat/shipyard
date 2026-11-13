import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDatabaseFromEnvMock, migrateMock, mockDb, mockPool } = vi.hoisted(
  () => {
    const mockDb = { kind: "db" };
    const mockPool = {
      end: vi.fn().mockResolvedValue(undefined),
    };
    const createDatabaseFromEnvMock = vi.fn(() => ({
      db: mockDb,
      pool: mockPool,
    }));
    const migrateMock = vi.fn().mockResolvedValue(undefined);

    return {
      createDatabaseFromEnvMock,
      migrateMock,
      mockDb,
      mockPool,
    };
  },
);

vi.mock("./client", () => ({
  createDatabaseFromEnv: createDatabaseFromEnvMock,
}));

vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: migrateMock,
}));

import { defaultMigrationsFolder, runMigrations } from "./migrate";

describe("@shipyard/db migrations", () => {
  beforeEach(() => {
    createDatabaseFromEnvMock.mockClear();
    migrateMock.mockClear();
    mockPool.end.mockClear();
    migrateMock.mockResolvedValue(undefined);
  });

  it("runs the committed migrations against the shared connection factory", async () => {
    await runMigrations({
      env: {
        DATABASE_URL: "postgresql://shipyard:secret@localhost:15432/shipyard",
      },
    });

    expect(createDatabaseFromEnvMock).toHaveBeenCalledWith({
      DATABASE_URL: "postgresql://shipyard:secret@localhost:15432/shipyard",
    });
    expect(migrateMock).toHaveBeenCalledWith(mockDb, {
      migrationsFolder: defaultMigrationsFolder,
    });
    expect(mockPool.end).toHaveBeenCalledOnce();
  });

  it("closes the pool and rethrows when a migration fails", async () => {
    const failure = new Error("statement failed");
    migrateMock.mockRejectedValueOnce(failure);

    await expect(
      runMigrations({
        migrationsFolder: "/tmp/shipyard-failing-migrations",
      }),
    ).rejects.toThrowError("statement failed");
    expect(mockPool.end).toHaveBeenCalledOnce();
  });
});
