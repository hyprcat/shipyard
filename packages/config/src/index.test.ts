import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  loadControlPlaneEnv,
  loadWorkerEnv,
} from "./index";

const validEnv = {
  DATABASE_URL: "postgresql://shipyard:secret@localhost:15432/shipyard",
  REDIS_URL: "redis://localhost:16379/0",
  S3_ENDPOINT: "http://localhost:19000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "shipyard-local",
  S3_ACCESS_KEY_ID: "shipyard",
  S3_SECRET_ACCESS_KEY: "shipyard-dev-minio",
  S3_FORCE_PATH_STYLE: "true",
} satisfies Record<string, string>;

describe("@shipyard/config", () => {
  it("parses shared server env into typed config", () => {
    expect(loadControlPlaneEnv(validEnv)).toEqual({
      databaseUrl: validEnv.DATABASE_URL,
      redisUrl: validEnv.REDIS_URL,
      objectStorage: {
        endpoint: validEnv.S3_ENDPOINT,
        region: validEnv.S3_REGION,
        bucket: validEnv.S3_BUCKET,
        accessKeyId: validEnv.S3_ACCESS_KEY_ID,
        secretAccessKey: validEnv.S3_SECRET_ACCESS_KEY,
        forcePathStyle: true,
      },
    });
  });

  it("raises typed validation errors for malformed env", () => {
    expect(() =>
      loadWorkerEnv({
        ...validEnv,
        DATABASE_URL: "not-a-database-url",
        S3_FORCE_PATH_STYLE: "sometimes",
      }),
    ).toThrowError(EnvironmentValidationError);
  });
});
