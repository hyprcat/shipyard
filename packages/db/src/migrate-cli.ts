import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { runMigrations } from "./migrate";

const rootEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));

try {
  try {
    loadEnvFile(rootEnvPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await runMigrations();
  console.log("Database migrations applied.");
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
}
