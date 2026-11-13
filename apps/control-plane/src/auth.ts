import { randomUUID } from "node:crypto";

import * as argon2 from "argon2";
import {
  createTeamMembership,
  sessions,
  type ShipyardDatabase,
  teams,
  users,
} from "@shipyard/db";
import { eq } from "drizzle-orm";

export type AuthErrorCode =
  | "API_KEY_INVALID"
  | "API_KEY_REVOKED"
  | "DUPLICATE_EMAIL"
  | "INVALID_CREDENTIALS"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_FOUND";

export type AuthUser = typeof users.$inferSelect;
export type AuthSession = typeof sessions.$inferSelect;
export type AuthTeam = typeof teams.$inferSelect;

export interface AuthenticatedSession extends AuthSession {
  user: AuthUser;
}

export interface RegistrationResult {
  session: AuthSession;
  team: AuthTeam;
  user: AuthUser;
}

export interface LoginResult {
  session: AuthSession;
  user: AuthUser;
}

export interface CreateUserInput {
  email: string;
  password: string;
}

export interface CreateSessionInput {
  userId: string;
  expiresAt?: Date;
  ttlMs?: number;
}

export interface AuthServiceOptions {
  db: ShipyardDatabase;
  now?: () => Date;
  generateId?: () => string;
  sessionTtlMs?: number;
}

interface DatabaseErrorShape {
  code?: string;
  constraint?: string;
}

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly statusCode: number;

  constructor(code: AuthErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PASSWORD_VERIFICATION_FALLBACK_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$dxKEXegu69CzGy1o9fVZOg$rxkINYLnb0k1WnrxWiEyV6Y07IIMf63u74AslKNIX7U";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const emailLocalPart = (email: string): string =>
  normalizeEmail(email).split("@")[0] ?? "shipyard";

const buildDefaultTeamName = (email: string): string =>
  `${
    emailLocalPart(email)
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || "Shipyard"
  } Team`;

const buildDefaultTeamSlug = (email: string, teamId: string): string =>
  `${
    emailLocalPart(email)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "team"
  }-${teamId.replace(/[^a-z0-9]/g, "").slice(0, 8)}`;

const isUniqueEmailViolation = (error: unknown): error is DatabaseErrorShape =>
  typeof error === "object" &&
  error !== null &&
  (error as DatabaseErrorShape).code === "23505" &&
  (error as DatabaseErrorShape).constraint === "users_email_uidx";

const hashPassword = async (password: string): Promise<string> =>
  argon2.hash(password, {
    type: argon2.argon2id,
  });

const invalidCredentialsError = (): AuthError =>
  new AuthError("INVALID_CREDENTIALS", "Invalid email or password", 401);

const unauthorizedSessionError = (
  code: Extract<AuthErrorCode, "SESSION_EXPIRED" | "SESSION_NOT_FOUND">,
): AuthError => new AuthError(code, "Unauthorized", 401);

const throwIfDuplicateEmail = (error: unknown): never => {
  if (isUniqueEmailViolation(error)) {
    throw new AuthError(
      "DUPLICATE_EMAIL",
      "A user with that email already exists",
      409,
    );
  }

  throw error;
};

export const createAuthService = ({
  db,
  now = () => new Date(),
  generateId = randomUUID,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
}: AuthServiceOptions) => {
  const createSession = async (
    input: CreateSessionInput,
  ): Promise<AuthSession> => {
    const [session] = await db
      .insert(sessions)
      .values({
        id: generateId(),
        userId: input.userId,
        expiresAt:
          input.expiresAt ??
          new Date(now().getTime() + (input.ttlMs ?? sessionTtlMs)),
      })
      .returning();

    return session;
  };

  const getSession = async (
    sessionId: string,
  ): Promise<AuthenticatedSession> => {
    const [record] = await db
      .select()
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!record) {
      throw unauthorizedSessionError("SESSION_NOT_FOUND");
    }

    if (
      record.sessions.revokedAt !== null ||
      record.sessions.expiresAt <= now()
    ) {
      throw unauthorizedSessionError("SESSION_EXPIRED");
    }

    return {
      ...record.sessions,
      user: record.users,
    };
  };

  return {
    async createUser(input: CreateUserInput): Promise<AuthUser> {
      try {
        const [user] = await db
          .insert(users)
          .values({
            id: generateId(),
            email: normalizeEmail(input.email),
            passwordHash: await hashPassword(input.password),
          })
          .returning();

        return user;
      } catch (error) {
        return throwIfDuplicateEmail(error);
      }
    },

    async registerUser(input: CreateUserInput): Promise<RegistrationResult> {
      const email = normalizeEmail(input.email);
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + sessionTtlMs);
      const passwordHash = await hashPassword(input.password);

      try {
        return await db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({
              id: generateId(),
              email,
              passwordHash,
            })
            .returning();

          const [team] = await tx
            .insert(teams)
            .values({
              id: generateId(),
              name: buildDefaultTeamName(email),
              slug: buildDefaultTeamSlug(email, user.id),
              billingOwnerUserId: user.id,
            })
            .returning();

          await createTeamMembership(tx, {
            acceptedAt: createdAt,
            id: generateId(),
            invitedAt: createdAt,
            role: "owner",
            teamId: team.id,
            userId: user.id,
          });

          const [session] = await tx
            .insert(sessions)
            .values({
              id: generateId(),
              userId: user.id,
              expiresAt,
            })
            .returning();

          return {
            user,
            team,
            session,
          };
        });
      } catch (error) {
        return throwIfDuplicateEmail(error);
      }
    },

    async loginUser(input: CreateUserInput): Promise<LoginResult> {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizeEmail(input.email)))
        .limit(1);

      const passwordMatches = await argon2.verify(
        user?.passwordHash ?? PASSWORD_VERIFICATION_FALLBACK_HASH,
        input.password,
      );

      if (!user || !passwordMatches) {
        throw invalidCredentialsError();
      }

      const session = await createSession({
        userId: user.id,
      });

      return {
        session,
        user,
      };
    },

    createSession,
    getSession,

    async revokeSession(sessionId: string): Promise<void> {
      await db
        .update(sessions)
        .set({
          revokedAt: now(),
        })
        .where(eq(sessions.id, sessionId));
    },
  };
};

export type AuthService = ReturnType<typeof createAuthService>;
