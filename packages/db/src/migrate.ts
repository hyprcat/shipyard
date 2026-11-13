import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabaseFromEnv } from "./client";

export const defaultMigrationsFolder = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);

export interface RunMigrationsOptions {
  env?: Record<string, string | undefined>;
  migrationsFolder?: string;
}

export const runMigrations = async (
  options: RunMigrationsOptions = {},
): Promise<void> => {
  const connection = createDatabaseFromEnv(options.env);

  try {
    await migrate(connection.db, {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
    });
  } finally {
    await connection.pool.end();
  }
};
