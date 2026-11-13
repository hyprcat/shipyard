import { beforeEach, describe, expect, it, vi } from "vitest";

const { drizzleMock, mockDb, mockPoolEnd, mockPoolOptions, MockPool } =
  vi.hoisted(() => {
    const drizzleMock = vi.fn();
    const mockDb = { kind: "db" };
    const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
    const mockPoolOptions = vi.fn();

    class MockPool {
      end = mockPoolEnd;

      constructor(options: unknown) {
        mockPoolOptions(options);
      }
    }

    drizzleMock.mockReturnValue(mockDb);

    return {
      drizzleMock,
      mockDb,
      mockPoolEnd,
      mockPoolOptions,
      MockPool,
    };
  });

vi.mock("pg", () => ({
  Pool: MockPool,
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: drizzleMock,
}));

import {
  DatabaseUrlValidationError,
  createDatabase,
  resolveDatabaseUrl,
} from "./client";
import { schema } from "./schema";

describe("@shipyard/db client", () => {
  beforeEach(() => {
    drizzleMock.mockClear();
    mockPoolEnd.mockClear();
    mockPoolOptions.mockClear();
  });

  it("validates DATABASE_URL before creating a connection", () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: "postgresql://shipyard:secret@localhost:15432/shipyard",
      }),
    ).toBe("postgresql://shipyard:secret@localhost:15432/shipyard");

    expect(() => resolveDatabaseUrl({ DATABASE_URL: undefined })).toThrowError(
      DatabaseUrlValidationError,
    );
    expect(() =>
      resolveDatabaseUrl({ DATABASE_URL: "mysql://localhost/db" }),
    ).toThrowError(DatabaseUrlValidationError);
  });

  it("builds a typed drizzle client around a pg pool", () => {
    const connection = createDatabase(
      "postgresql://shipyard:secret@localhost:15432/shipyard",
      { max: 4 },
    );

    expect(mockPoolOptions).toHaveBeenCalledWith({
      connectionString: "postgresql://shipyard:secret@localhost:15432/shipyard",
      max: 4,
    });
    expect(drizzleMock).toHaveBeenCalledWith({
      client: connection.pool,
      schema,
    });
    expect(connection.db).toBe(mockDb);
  });
});
