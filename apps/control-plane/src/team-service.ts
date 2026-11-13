import { randomUUID } from "node:crypto";

import {
  parseTeamRole,
  teamInvitations,
  teamMemberships,
  type ShipyardDatabase,
  type TeamRole,
  users,
} from "@shipyard/db";
import { and, asc, eq, isNull } from "drizzle-orm";

export interface TeamServiceOptions {
  db: ShipyardDatabase;
  generateId?: () => string;
  invitationTtlMs?: number;
  now?: () => Date;
}

export interface TeamRosterMember {
  acceptedAt: Date | null;
  email: string;
  id: string;
  invitedAt: Date;
  role: TeamRole;
  userId: string;
}

export interface TeamRosterInvitation {
  email: string;
  expiresAt: Date;
  id: string;
  invitedAt: Date;
  role: TeamRole;
  status: "expired" | "pending";
}

export interface TeamRoster {
  currentUserRole: TeamRole;
  invitations: TeamRosterInvitation[];
  members: TeamRosterMember[];
}

export interface TeamService {
  inviteMember(input: {
    email: string;
    role: string;
    teamId: string;
    userId: string;
  }): Promise<TeamRosterInvitation>;
  listMembers(input: { teamId: string; userId: string }): Promise<TeamRoster>;
  removeMember(input: {
    membershipId: string;
    teamId: string;
    userId: string;
  }): Promise<void>;
  updateMemberRole(input: {
    membershipId: string;
    role: string;
    teamId: string;
    userId: string;
  }): Promise<TeamRosterMember>;
}

export type TeamServiceErrorCode =
  | "AUTHORIZATION_ERROR"
  | "INVITATION_ALREADY_EXISTS"
  | "MEMBERSHIP_NOT_FOUND";

export class TeamServiceError extends Error {
  readonly code: TeamServiceErrorCode;
  readonly statusCode: number;

  constructor(code: TeamServiceErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "TeamServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const DEFAULT_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const authorizationError = () =>
  new TeamServiceError("AUTHORIZATION_ERROR", "Forbidden", 403);

const membershipNotFoundError = () =>
  new TeamServiceError("MEMBERSHIP_NOT_FOUND", "Team member not found", 404);

export const createTeamService = ({
  db,
  generateId = randomUUID,
  invitationTtlMs = DEFAULT_INVITATION_TTL_MS,
  now = () => new Date(),
}: TeamServiceOptions): TeamService => {
  const getActorMembership = async (teamId: string, userId: string) => {
    const [membership] = await db
      .select({
        id: teamMemberships.id,
        role: teamMemberships.role,
        userId: teamMemberships.userId,
      })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.userId, userId),
          isNull(teamMemberships.removedAt),
        ),
      )
      .limit(1);

    if (!membership) {
      throw authorizationError();
    }

    return membership;
  };

  const requireOwner = async (teamId: string, userId: string) => {
    const membership = await getActorMembership(teamId, userId);

    if (membership.role !== "owner") {
      throw authorizationError();
    }

    return membership;
  };

  const getTargetMembership = async (teamId: string, membershipId: string) => {
    const [membership] = await db
      .select({
        acceptedAt: teamMemberships.acceptedAt,
        email: users.email,
        id: teamMemberships.id,
        invitedAt: teamMemberships.invitedAt,
        role: teamMemberships.role,
        userId: teamMemberships.userId,
      })
      .from(teamMemberships)
      .innerJoin(users, eq(teamMemberships.userId, users.id))
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.id, membershipId),
          isNull(teamMemberships.removedAt),
        ),
      )
      .limit(1);

    if (!membership) {
      throw membershipNotFoundError();
    }

    return membership;
  };

  return {
    async listMembers({ teamId, userId }) {
      const actorMembership = await getActorMembership(teamId, userId);
      const invitations = await db
        .select({
          email: teamInvitations.email,
          expiresAt: teamInvitations.expiresAt,
          id: teamInvitations.id,
          invitedAt: teamInvitations.invitedAt,
          role: teamInvitations.role,
        })
        .from(teamInvitations)
        .where(
          and(
            eq(teamInvitations.teamId, teamId),
            isNull(teamInvitations.acceptedAt),
            isNull(teamInvitations.revokedAt),
          ),
        )
        .orderBy(asc(teamInvitations.email));
      const members = await db
        .select({
          acceptedAt: teamMemberships.acceptedAt,
          email: users.email,
          id: teamMemberships.id,
          invitedAt: teamMemberships.invitedAt,
          role: teamMemberships.role,
          userId: teamMemberships.userId,
        })
        .from(teamMemberships)
        .innerJoin(users, eq(teamMemberships.userId, users.id))
        .where(
          and(
            eq(teamMemberships.teamId, teamId),
            isNull(teamMemberships.removedAt),
          ),
        )
        .orderBy(asc(users.email));

      return {
        currentUserRole: actorMembership.role,
        invitations: invitations.map((invitation) => ({
          ...invitation,
          status: invitation.expiresAt <= now() ? "expired" : "pending",
        })),
        members,
      };
    },

    async inviteMember({ email, role, teamId, userId }) {
      await requireOwner(teamId, userId);

      const normalizedEmail = normalizeEmail(email);
      const [existingInvitation] = await db
        .select({ id: teamInvitations.id })
        .from(teamInvitations)
        .where(
          and(
            eq(teamInvitations.teamId, teamId),
            eq(teamInvitations.email, normalizedEmail),
            isNull(teamInvitations.acceptedAt),
            isNull(teamInvitations.revokedAt),
          ),
        )
        .limit(1);

      if (existingInvitation) {
        throw new TeamServiceError(
          "INVITATION_ALREADY_EXISTS",
          "A pending invitation already exists for that email",
          409,
        );
      }

      const [existingMember] = await db
        .select({ id: teamMemberships.id })
        .from(teamMemberships)
        .innerJoin(users, eq(teamMemberships.userId, users.id))
        .where(
          and(
            eq(teamMemberships.teamId, teamId),
            eq(users.email, normalizedEmail),
            isNull(teamMemberships.removedAt),
          ),
        )
        .limit(1);

      if (existingMember) {
        throw new TeamServiceError(
          "INVITATION_ALREADY_EXISTS",
          "User is already a member of this team",
          409,
        );
      }

      const [invitation] = await db
        .insert(teamInvitations)
        .values({
          email: normalizedEmail,
          expiresAt: new Date(now().getTime() + invitationTtlMs),
          id: generateId(),
          invitedByUserId: userId,
          role: parseTeamRole(role),
          teamId,
        })
        .returning();

      return {
        ...invitation,
        status: "pending",
      };
    },

    async removeMember({ membershipId, teamId, userId }) {
      await requireOwner(teamId, userId);
      await getTargetMembership(teamId, membershipId);

      await db
        .update(teamMemberships)
        .set({ removedAt: now() })
        .where(eq(teamMemberships.id, membershipId));
    },

    async updateMemberRole({ membershipId, role, teamId, userId }) {
      await requireOwner(teamId, userId);

      const nextRole = parseTeamRole(role);
      const membership = await getTargetMembership(teamId, membershipId);

      await db
        .update(teamMemberships)
        .set({ role: nextRole })
        .where(eq(teamMemberships.id, membershipId));

      return {
        ...membership,
        role: nextRole,
      };
    },
  };
};
