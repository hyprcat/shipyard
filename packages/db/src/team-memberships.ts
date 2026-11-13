import { and, eq } from "drizzle-orm";

import type { ShipyardDatabase } from "./client";
import { teamMemberships } from "./schema";

export const teamRoles = ["owner", "admin", "operator", "viewer"] as const;

export type TeamRole = (typeof teamRoles)[number];

export type TeamMembership = typeof teamMemberships.$inferSelect;

export interface CreateTeamMembershipInput {
  acceptedAt?: Date;
  id: string;
  invitedAt?: Date;
  invitedByUserId?: string | null;
  role: string;
  teamId: string;
  userId: string;
}

export type TeamMembershipWriter = Pick<ShipyardDatabase, "insert" | "select">;

export type TeamPersistenceErrorCode = "DUPLICATE_MEMBERSHIP" | "INVALID_ROLE";

const teamRoleSet = new Set<string>(teamRoles);

export class TeamPersistenceError extends Error {
  readonly code: TeamPersistenceErrorCode;
  readonly statusCode: number;

  constructor(
    code: TeamPersistenceErrorCode,
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "TeamPersistenceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const parseTeamRole = (value: string): TeamRole => {
  const role = value.trim();

  if (teamRoleSet.has(role)) {
    return role as TeamRole;
  }

  throw new TeamPersistenceError(
    "INVALID_ROLE",
    `Invalid team role: ${value}`,
    400,
  );
};

export const createTeamMembership = async (
  db: TeamMembershipWriter,
  input: CreateTeamMembershipInput,
): Promise<TeamMembership> => {
  const role = parseTeamRole(input.role);
  const [existingMembership] = await db
    .select({ id: teamMemberships.id })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.teamId, input.teamId),
        eq(teamMemberships.userId, input.userId),
      ),
    )
    .limit(1);

  if (existingMembership) {
    throw new TeamPersistenceError(
      "DUPLICATE_MEMBERSHIP",
      "User is already a member of this team",
      409,
    );
  }

  const [membership] = await db
    .insert(teamMemberships)
    .values({
      acceptedAt: input.acceptedAt,
      id: input.id,
      invitedAt: input.invitedAt,
      invitedByUserId: input.invitedByUserId,
      role,
      teamId: input.teamId,
      userId: input.userId,
    })
    .returning();

  return membership;
};
