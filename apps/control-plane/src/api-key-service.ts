import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { apiKeys, type ShipyardDatabase } from "@shipyard/db";
import { eq } from "drizzle-orm";

import { AuthError } from "./auth";

export interface IssuedApiKey {
  id: string;
  isBootstrapSuperuser: boolean;
  label: string;
  prefix: string;
  secret: string;
  teamId: string | null;
}

export interface AuthenticatedApiKey {
  createdByUserId: string | null;
  id: string;
  isBootstrapSuperuser: boolean;
  label: string;
  prefix: string;
  teamId: string | null;
}

export interface ApiKeyService {
  authenticateApiKey(token: string): Promise<AuthenticatedApiKey>;
  createBootstrapSuperuserApiKey(input: {
    createdByUserId?: string;
    label: string;
  }): Promise<IssuedApiKey>;
  createTeamApiKey(input: {
    createdByUserId: string;
    label: string;
    teamId: string;
  }): Promise<IssuedApiKey>;
}

export interface ApiKeyServiceOptions {
  db: ShipyardDatabase;
  generateId?: () => string;
  generateRandomBytes?: (size: number) => Buffer;
  now?: () => Date;
}

const invalidApiKeyError = (code: "API_KEY_INVALID" | "API_KEY_REVOKED") =>
  new AuthError(code, "Unauthorized", 401);

const normalizeLabel = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const hashesMatch = (left: string, right: string): boolean =>
  left.length === right.length &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));

const teamTokenPattern = /^(sy_[a-f0-9]{8})_[A-Za-z0-9_-]+$/;
const bootstrapTokenPattern = /^(SY_BOOTSTRAP_[A-F0-9]{8})_[A-Za-z0-9_-]+$/;

const parseTokenPrefix = (token: string): string => {
  const teamMatch = token.match(teamTokenPattern);

  if (teamMatch) {
    return teamMatch[1];
  }

  const bootstrapMatch = token.match(bootstrapTokenPattern);

  if (bootstrapMatch) {
    return bootstrapMatch[1];
  }

  throw invalidApiKeyError("API_KEY_INVALID");
};

export const createApiKeyService = ({
  db,
  generateId = randomUUID,
  generateRandomBytes = randomBytes,
  now = () => new Date(),
}: ApiKeyServiceOptions): ApiKeyService => {
  const createKey = async ({
    createdByUserId,
    isBootstrapSuperuser,
    label,
    teamId,
  }: {
    createdByUserId: string | null;
    isBootstrapSuperuser: boolean;
    label: string;
    teamId: string | null;
  }): Promise<IssuedApiKey> => {
    const prefix = isBootstrapSuperuser
      ? `SY_BOOTSTRAP_${generateRandomBytes(4).toString("hex").toUpperCase()}`
      : `sy_${generateRandomBytes(4).toString("hex")}`;
    const secret = `${prefix}_${generateRandomBytes(24).toString("base64url")}`;
    const [record] = await db
      .insert(apiKeys)
      .values({
        createdByUserId,
        hashedSecret: hashToken(secret),
        id: generateId(),
        isBootstrapSuperuser,
        label: normalizeLabel(label),
        prefix,
        teamId,
      })
      .returning({
        id: apiKeys.id,
        isBootstrapSuperuser: apiKeys.isBootstrapSuperuser,
        label: apiKeys.label,
        prefix: apiKeys.prefix,
        teamId: apiKeys.teamId,
      });

    return {
      ...record,
      secret,
    };
  };

  return {
    async createTeamApiKey({ createdByUserId, label, teamId }) {
      return createKey({
        createdByUserId,
        isBootstrapSuperuser: false,
        label,
        teamId,
      });
    },

    async createBootstrapSuperuserApiKey({ createdByUserId, label }) {
      return createKey({
        createdByUserId: createdByUserId ?? null,
        isBootstrapSuperuser: true,
        label,
        teamId: null,
      });
    },

    async authenticateApiKey(token) {
      const prefix = parseTokenPrefix(token);
      const [record] = await db
        .select({
          createdByUserId: apiKeys.createdByUserId,
          hashedSecret: apiKeys.hashedSecret,
          id: apiKeys.id,
          isBootstrapSuperuser: apiKeys.isBootstrapSuperuser,
          label: apiKeys.label,
          prefix: apiKeys.prefix,
          revokedAt: apiKeys.revokedAt,
          teamId: apiKeys.teamId,
        })
        .from(apiKeys)
        .where(eq(apiKeys.prefix, prefix))
        .limit(1);

      if (!record) {
        throw invalidApiKeyError("API_KEY_INVALID");
      }

      if (record.revokedAt !== null) {
        throw invalidApiKeyError("API_KEY_REVOKED");
      }

      if (!hashesMatch(record.hashedSecret, hashToken(token))) {
        throw invalidApiKeyError("API_KEY_INVALID");
      }

      await db
        .update(apiKeys)
        .set({
          lastUsedAt: now(),
        })
        .where(eq(apiKeys.id, record.id));

      return {
        createdByUserId: record.createdByUserId,
        id: record.id,
        isBootstrapSuperuser: record.isBootstrapSuperuser,
        label: record.label,
        prefix: record.prefix,
        teamId: record.teamId,
      };
    },
  };
};
