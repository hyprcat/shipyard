import { randomUUID } from "node:crypto";

import {
  apiKeys,
  projects,
  teamMemberships,
  teams,
  users,
  type ShipyardDatabase,
} from "@shipyard/db";
import { and, asc, count, eq, isNull } from "drizzle-orm";

import { createApiKeyService, type ApiKeyService } from "./api-key-service";

export type OnboardingStep = "team" | "apiKey" | "project" | "complete";

export interface OnboardingState {
  apiKeyCount: number;
  firstIncompleteStep: OnboardingStep;
  onboardingCompletedAt: Date | null;
  onboardingTeamConfirmedAt: Date | null;
  projectCount: number;
  team: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface OnboardingApiKey {
  id: string;
  label: string;
  prefix: string;
  secret: string;
}

export interface OnboardingProject {
  createdAt: Date;
  id: string;
  name: string;
  slug: string;
}

export interface OnboardingService {
  confirmTeam(input: {
    name: string;
    userId: string;
  }): Promise<OnboardingState>;
  createApiKey(input: {
    label: string;
    userId: string;
  }): Promise<{ apiKey: OnboardingApiKey; state: OnboardingState }>;
  createProject(input: {
    name: string;
    userId: string;
  }): Promise<{ project: OnboardingProject; state: OnboardingState }>;
  getState(input: { userId: string }): Promise<OnboardingState>;
  listProjects(input: { userId: string }): Promise<OnboardingProject[]>;
  listProjectsByTeam(input: { teamId: string }): Promise<OnboardingProject[]>;
}

export interface OnboardingServiceOptions {
  apiKeyService?: ApiKeyService;
  db: ShipyardDatabase;
  generateId?: () => string;
  now?: () => Date;
}

export type OnboardingServiceErrorCode =
  | "AUTHORIZATION_ERROR"
  | "PROJECT_ALREADY_EXISTS"
  | "STEP_OUT_OF_ORDER";

interface DatabaseErrorShape {
  code?: string;
  constraint?: string;
}

type TeamContext = {
  id: string;
  name: string;
  slug: string;
};

export class OnboardingServiceError extends Error {
  readonly code: OnboardingServiceErrorCode;
  readonly statusCode: number;

  constructor(
    code: OnboardingServiceErrorCode,
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "OnboardingServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const authorizationError = () =>
  new OnboardingServiceError(
    "AUTHORIZATION_ERROR",
    "You do not have an active team for onboarding",
    403,
  );

const stepOutOfOrderError = (message: string) =>
  new OnboardingServiceError("STEP_OUT_OF_ORDER", message, 409);

const isUniqueProjectSlugViolation = (
  error: unknown,
): error is DatabaseErrorShape =>
  typeof error === "object" &&
  error !== null &&
  (error as DatabaseErrorShape).code === "23505" &&
  (error as DatabaseErrorShape).constraint === "projects_team_slug_uidx";

const normalizeName = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const slugify = (value: string): string =>
  normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";

export const resolveFirstIncompleteStep = ({
  apiKeyCount,
  onboardingTeamConfirmedAt,
  projectCount,
}: {
  apiKeyCount: number;
  onboardingTeamConfirmedAt: Date | null;
  projectCount: number;
}): OnboardingStep => {
  if (!onboardingTeamConfirmedAt) {
    return "team";
  }

  if (apiKeyCount === 0) {
    return "apiKey";
  }

  if (projectCount === 0) {
    return "project";
  }

  return "complete";
};

export const createOnboardingService = ({
  apiKeyService,
  db,
  generateId = randomUUID,
  now = () => new Date(),
}: OnboardingServiceOptions): OnboardingService => {
  const keyService =
    apiKeyService ??
    createApiKeyService({
      db,
      generateId,
      now,
    });
  const getTeamContext = async (userId: string): Promise<TeamContext> => {
    const [team] = await db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
      })
      .from(teamMemberships)
      .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
      .where(
        and(
          eq(teamMemberships.userId, userId),
          isNull(teamMemberships.removedAt),
        ),
      )
      .orderBy(asc(teamMemberships.invitedAt))
      .limit(1);

    if (!team) {
      throw authorizationError();
    }

    return team;
  };

  const getUserProgress = async (userId: string) => {
    const [user] = await db
      .select({
        onboardingCompletedAt: users.onboardingCompletedAt,
        onboardingTeamConfirmedAt: users.onboardingTeamConfirmedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw authorizationError();
    }

    return user;
  };

  const countApiKeys = async (teamId: string): Promise<number> => {
    const [result] = await db
      .select({
        value: count(apiKeys.id),
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.teamId, teamId), isNull(apiKeys.revokedAt)));

    return result?.value ?? 0;
  };

  const countProjects = async (teamId: string): Promise<number> => {
    const [result] = await db
      .select({
        value: count(projects.id),
      })
      .from(projects)
      .where(eq(projects.teamId, teamId));

    return result?.value ?? 0;
  };

  const buildState = async (userId: string): Promise<OnboardingState> => {
    const [team, user] = await Promise.all([
      getTeamContext(userId),
      getUserProgress(userId),
    ]);
    const [apiKeyCount, projectCount] = await Promise.all([
      countApiKeys(team.id),
      countProjects(team.id),
    ]);

    return {
      apiKeyCount,
      firstIncompleteStep: resolveFirstIncompleteStep({
        apiKeyCount,
        onboardingTeamConfirmedAt: user.onboardingTeamConfirmedAt,
        projectCount,
      }),
      onboardingCompletedAt: user.onboardingCompletedAt,
      onboardingTeamConfirmedAt: user.onboardingTeamConfirmedAt,
      projectCount,
      team,
    };
  };

  return {
    async getState({ userId }) {
      return buildState(userId);
    },

    async confirmTeam({ name, userId }) {
      const team = await getTeamContext(userId);

      await db
        .update(teams)
        .set({
          name: normalizeName(name),
        })
        .where(eq(teams.id, team.id));
      await db
        .update(users)
        .set({
          onboardingTeamConfirmedAt: now(),
        })
        .where(eq(users.id, userId));

      return buildState(userId);
    },

    async createApiKey({ label, userId }) {
      const state = await buildState(userId);

      if (state.firstIncompleteStep !== "apiKey") {
        throw stepOutOfOrderError(
          "Confirm your team before creating your first API key.",
        );
      }

      const record = await keyService.createTeamApiKey({
        createdByUserId: userId,
        label,
        teamId: state.team.id,
      });

      return {
        apiKey: {
          id: record.id,
          label: record.label,
          prefix: record.prefix,
          secret: record.secret,
        },
        state: await buildState(userId),
      };
    },

    async createProject({ name, userId }) {
      const state = await buildState(userId);

      if (state.firstIncompleteStep !== "project") {
        throw stepOutOfOrderError(
          "Create an API key before creating your first project.",
        );
      }

      try {
        const [project] = await db
          .insert(projects)
          .values({
            id: generateId(),
            name: normalizeName(name),
            slug: slugify(name),
            teamId: state.team.id,
          })
          .returning({
            createdAt: projects.createdAt,
            id: projects.id,
            name: projects.name,
            slug: projects.slug,
          });

        await db
          .update(users)
          .set({
            onboardingCompletedAt: now(),
          })
          .where(eq(users.id, userId));

        return {
          project,
          state: await buildState(userId),
        };
      } catch (error) {
        if (isUniqueProjectSlugViolation(error)) {
          throw new OnboardingServiceError(
            "PROJECT_ALREADY_EXISTS",
            "A project with that name already exists for this team",
            409,
          );
        }

        throw error;
      }
    },

    async listProjects({ userId }) {
      const team = await getTeamContext(userId);

      return this.listProjectsByTeam({
        teamId: team.id,
      });
    },

    async listProjectsByTeam({ teamId }) {
      return db
        .select({
          createdAt: projects.createdAt,
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
        })
        .from(projects)
        .where(eq(projects.teamId, teamId))
        .orderBy(asc(projects.createdAt));
    },
  };
};
