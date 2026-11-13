import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { teamInvitations, teamMemberships, users } from "./schema";

describe("@shipyard/db schema", () => {
  it("stores persisted onboarding progress timestamps on users", () => {
    const columns = getTableColumns(users);

    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        "onboardingCompletedAt",
        "onboardingTeamConfirmedAt",
      ]),
    );
  });

  it("stores team memberships with explicit roles and lifecycle metadata", () => {
    const columns = getTableColumns(teamMemberships);

    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        "acceptedAt",
        "invitedAt",
        "invitedByUserId",
        "removedAt",
        "role",
      ]),
    );
    expect(columns.role.enumValues).toEqual([
      "owner",
      "admin",
      "operator",
      "viewer",
    ]);
    expect(
      getTableConfig(teamMemberships).indexes.map((index) => index.config.name),
    ).toContain("team_memberships_team_user_uidx");
  });

  it("stores pending team invitations with lifecycle timestamps", () => {
    const columns = getTableColumns(teamInvitations);

    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        "acceptedAt",
        "createdAt",
        "email",
        "expiresAt",
        "invitedAt",
        "invitedByUserId",
        "revokedAt",
        "role",
      ]),
    );
    expect(columns.role.enumValues).toEqual([
      "owner",
      "admin",
      "operator",
      "viewer",
    ]);
    expect(
      getTableConfig(teamInvitations).indexes.map((index) => index.config.name),
    ).toContain("team_invitations_team_id_idx");
  });
});
