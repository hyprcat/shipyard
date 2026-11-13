import { createHash } from "node:crypto";

import { apiKeys } from "@shipyard/db";
import { describe, expect, it, vi } from "vitest";

import { createApiKeyService } from "./api-key-service";

const createDbMock = () => {
  const insertOperations: Array<{
    table: unknown;
    values: Record<string, unknown>;
  }> = [];
  const selectResults: unknown[][] = [];
  const returning = vi.fn().mockImplementation(async () => {
    const inserted = insertOperations.at(-1)?.values ?? {};

    return [
      {
        id: inserted.id,
        isBootstrapSuperuser: inserted.isBootstrapSuperuser,
        label: inserted.label,
        prefix: inserted.prefix,
        teamId: inserted.teamId ?? null,
      },
    ];
  });
  const insert = vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      insertOperations.push({ table, values });

      return {
        returning,
      };
    },
  }));
  const limit = vi
    .fn()
    .mockImplementation(async () => selectResults.shift() ?? []);
  const where = vi.fn(() => ({
    limit,
  }));
  const from = vi.fn(() => ({
    where,
  }));
  const select = vi.fn(() => ({
    from,
  }));
  const updateWhere = vi.fn().mockResolvedValue([]);
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
    insertOperations,
    select,
    selectResults,
    set,
    update,
    updateWhere,
  };
};

describe("@shipyard/control-plane api key service", () => {
  it("stores only a hash and prefix for issued team API keys", async () => {
    const db = createDbMock();
    const service = createApiKeyService({
      db: db.db as never,
      generateId: () => "key-1",
      generateRandomBytes: (size) =>
        size === 4 ? Buffer.from("abcd1234", "hex") : Buffer.alloc(size, 1),
    });

    const apiKey = await service.createTeamApiKey({
      createdByUserId: "user-1",
      label: " Local CLI ",
      teamId: "team-1",
    });

    expect(apiKey).toEqual({
      id: "key-1",
      isBootstrapSuperuser: false,
      label: "Local CLI",
      prefix: "sy_abcd1234",
      secret: expect.stringMatching(/^sy_abcd1234_/),
      teamId: "team-1",
    });
    expect(db.insertOperations).toEqual([
      {
        table: apiKeys,
        values: {
          createdByUserId: "user-1",
          hashedSecret: createHash("sha256")
            .update(apiKey.secret)
            .digest("hex"),
          id: "key-1",
          isBootstrapSuperuser: false,
          label: "Local CLI",
          prefix: "sy_abcd1234",
          teamId: "team-1",
        },
      },
    ]);
    expect(JSON.stringify(db.insertOperations[0]?.values)).not.toContain(
      apiKey.secret,
    );
  });

  it("issues optional bootstrap superuser keys without a team scope", async () => {
    const db = createDbMock();
    const service = createApiKeyService({
      db: db.db as never,
      generateId: () => "bootstrap-1",
      generateRandomBytes: (size) =>
        size === 4 ? Buffer.from("abcd1234", "hex") : Buffer.alloc(size, 2),
    });

    const apiKey = await service.createBootstrapSuperuserApiKey({
      label: "Initial bootstrap",
    });

    expect(apiKey).toEqual({
      id: "bootstrap-1",
      isBootstrapSuperuser: true,
      label: "Initial bootstrap",
      prefix: "SY_BOOTSTRAP_ABCD1234",
      secret: expect.stringMatching(/^SY_BOOTSTRAP_ABCD1234_/),
      teamId: null,
    });
    expect(db.insertOperations).toEqual([
      {
        table: apiKeys,
        values: expect.objectContaining({
          createdByUserId: null,
          isBootstrapSuperuser: true,
          prefix: "SY_BOOTSTRAP_ABCD1234",
          teamId: null,
        }),
      },
    ]);
  });

  it("authenticates known API keys and records last use metadata", async () => {
    const token = "sy_abcd1234_secret-token";
    const now = new Date("2026-03-09T01:00:00.000Z");
    const db = createDbMock();
    db.selectResults.push([
      {
        createdByUserId: "user-1",
        hashedSecret: createHash("sha256").update(token).digest("hex"),
        id: "key-1",
        isBootstrapSuperuser: false,
        label: "Local CLI",
        prefix: "sy_abcd1234",
        revokedAt: null,
        teamId: "team-1",
      },
    ]);
    const service = createApiKeyService({
      db: db.db as never,
      now: () => now,
    });

    const apiKey = await service.authenticateApiKey(token);

    expect(apiKey).toEqual({
      createdByUserId: "user-1",
      id: "key-1",
      isBootstrapSuperuser: false,
      label: "Local CLI",
      prefix: "sy_abcd1234",
      teamId: "team-1",
    });
    expect(db.update).toHaveBeenCalledWith(apiKeys);
    expect(db.set).toHaveBeenCalledWith({
      lastUsedAt: now,
    });
    expect(db.updateWhere).toHaveBeenCalledOnce();
  });

  it("rejects malformed API key prefixes before querying storage", async () => {
    const db = createDbMock();
    const service = createApiKeyService({
      db: db.db as never,
    });

    await expect(
      service.authenticateApiKey("not-a-shipyard-key"),
    ).rejects.toMatchObject({
      code: "API_KEY_INVALID",
      name: "AuthError",
      statusCode: 401,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects unknown and revoked API keys", async () => {
    const db = createDbMock();
    const service = createApiKeyService({
      db: db.db as never,
    });

    db.selectResults.push([]);
    await expect(
      service.authenticateApiKey("sy_abcd1234_unknown-secret"),
    ).rejects.toMatchObject({
      code: "API_KEY_INVALID",
      name: "AuthError",
      statusCode: 401,
    });

    db.selectResults.push([
      {
        createdByUserId: "user-1",
        hashedSecret: createHash("sha256")
          .update("sy_abcd1234_revoked-secret")
          .digest("hex"),
        id: "key-2",
        isBootstrapSuperuser: false,
        label: "Revoked",
        prefix: "sy_abcd1234",
        revokedAt: new Date("2026-03-09T00:00:00.000Z"),
        teamId: "team-1",
      },
    ]);
    await expect(
      service.authenticateApiKey("sy_abcd1234_revoked-secret"),
    ).rejects.toMatchObject({
      code: "API_KEY_REVOKED",
      name: "AuthError",
      statusCode: 401,
    });
  });
});
