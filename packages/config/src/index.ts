import { z, type ZodIssue } from "zod";

// Keep the shared workspace marker for scripts/validate-workspaces.ts: from "@/id"
export { id } from "./id";

const requiredValue = (name: string) =>
  z.string().trim().min(1, `${name} is required`);

const sharedServerEnvSchema = z
  .object({
    DATABASE_URL: requiredValue("DATABASE_URL")
      .url("DATABASE_URL must be a valid URL")
      .refine(
        (value) =>
          value.startsWith("postgres://") || value.startsWith("postgresql://"),
        "DATABASE_URL must use the postgres or postgresql protocol",
      ),
    REDIS_URL: requiredValue("REDIS_URL")
      .url("REDIS_URL must be a valid URL")
      .refine(
        (value) =>
          value.startsWith("redis://") || value.startsWith("rediss://"),
        "REDIS_URL must use the redis or rediss protocol",
      ),
    S3_ENDPOINT: requiredValue("S3_ENDPOINT").url(
      "S3_ENDPOINT must be a valid URL",
    ),
    S3_REGION: requiredValue("S3_REGION"),
    S3_BUCKET: requiredValue("S3_BUCKET"),
    S3_ACCESS_KEY_ID: requiredValue("S3_ACCESS_KEY_ID"),
    S3_SECRET_ACCESS_KEY: requiredValue("S3_SECRET_ACCESS_KEY"),
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .transform((env) => ({
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    objectStorage: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  }));

export type SharedServerEnv = z.infer<typeof sharedServerEnvSchema>;
export type ControlPlaneEnv = SharedServerEnv;
export type WorkerEnv = SharedServerEnv;

export class EnvironmentValidationError extends Error {
  readonly issues: ZodIssue[];

  constructor(appName: string, issues: ZodIssue[]) {
    super(
      `${appName} environment validation failed: ${issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );

    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

const loadEnv = (
  appName: string,
  env: Record<string, string | undefined>,
): SharedServerEnv => {
  const result = sharedServerEnvSchema.safeParse(env);

  if (!result.success) {
    throw new EnvironmentValidationError(appName, result.error.issues);
  }

  return result.data;
};

export const loadControlPlaneEnv = (
  env: Record<string, string | undefined> = process.env,
): ControlPlaneEnv => loadEnv("control-plane", env);

export const loadWorkerEnv = (
  env: Record<string, string | undefined> = process.env,
): WorkerEnv => loadEnv("worker", env);
