import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { schema } from "./schema";

export type DatabaseSchema = typeof schema;
export type ShipyardDatabase = NodePgDatabase<DatabaseSchema>;

export interface DatabaseConnection {
  db: ShipyardDatabase;
  pool: Pool;
}

export class DatabaseUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseUrlValidationError";
  }
}

export const resolveDatabaseUrl = (
  env: Record<string, string | undefined> = process.env,
): string => {
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new DatabaseUrlValidationError("DATABASE_URL must be set");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new DatabaseUrlValidationError("DATABASE_URL must be a valid URL");
  }

  if (
    parsedUrl.protocol !== "postgres:" &&
    parsedUrl.protocol !== "postgresql:"
  ) {
    throw new DatabaseUrlValidationError(
      "DATABASE_URL must use the postgres or postgresql protocol",
    );
  }

  return databaseUrl;
};

export const createDatabase = (
  databaseUrl: string,
  options: Omit<PoolConfig, "connectionString"> = {},
): DatabaseConnection => {
  const pool = new Pool({
    ...options,
    connectionString: databaseUrl,
  });

  return {
    db: drizzle({
      client: pool,
      schema,
    }),
    pool,
  };
};

export const createDatabaseFromEnv = (
  env: Record<string, string | undefined> = process.env,
  options: Omit<PoolConfig, "connectionString"> = {},
): DatabaseConnection => createDatabase(resolveDatabaseUrl(env), options);
