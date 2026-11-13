import { randomUUID } from "node:crypto";

import IORedis from "ioredis";
import { describe, expect, it } from "vitest";

import { runLocalNoopJob, startWorker } from "./index";

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

const canConnectToRedis = async (redisUrl: string): Promise<boolean> => {
  const redis = new IORedis(redisUrl, {
    connectTimeout: 250,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
};

const redisAvailable = await canConnectToRedis(validEnv.REDIS_URL);

const nextQueueName = (suffix: string): string =>
  `shipyard.jobs.${suffix}.${randomUUID()}`;

const createLogger = () => {
  const infoEntries: unknown[] = [];
  const errorEntries: unknown[] = [];

  return {
    error: (entry: unknown) => {
      errorEntries.push(entry);
    },
    errorEntries,
    info: (entry: unknown) => {
      infoEntries.push(entry);
    },
    infoEntries,
  };
};

describe.runIf(redisAvailable)("@shipyard/worker", () => {
  it("completes a local noop job against redis", async () => {
    const result = await runLocalNoopJob(validEnv, {
      logger: createLogger(),
      queueName: nextQueueName("noop"),
    });

    expect(result).toEqual({
      handledBy: "noop",
      ok: true,
      source: "local-smoke-test",
    });
  });

  it("fails unknown jobs with a structured worker error", async () => {
    const logger = createLogger();
    const runtime = await startWorker(validEnv, {
      logger,
      queueName: nextQueueName("unknown"),
    });

    try {
      const job = await runtime.queue.add("unknown-job", {
        requestedBy: "test",
      });

      await expect(
        job.waitUntilFinished(runtime.queueEvents, 5_000),
      ).rejects.toThrow('No handler registered for job "unknown-job"');
      expect(await job.getState()).toBe("failed");
      expect(logger.errorEntries).toContainEqual(
        expect.objectContaining({
          event: "worker.job.failed",
          jobName: "unknown-job",
          level: "error",
          queueName: runtime.queueName,
          error: expect.objectContaining({
            code: "UNKNOWN_JOB",
          }),
        }),
      );
      await job.remove();
    } finally {
      await runtime.close();
    }
  });
});

describe("@shipyard/worker startup failures", () => {
  it("emits a structured error when redis is unavailable", async () => {
    const logger = createLogger();

    await expect(
      startWorker(
        {
          ...validEnv,
          REDIS_URL: "redis://127.0.0.1:1/0",
        },
        {
          logger,
          queueName: nextQueueName("redis-error"),
          redisOptions: {
            connectTimeout: 250,
            retryStrategy: () => null,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "REDIS_CONNECTION_ERROR",
      name: "WorkerRuntimeError",
    });
    expect(logger.errorEntries).toContainEqual(
      expect.objectContaining({
        event: "worker.connection.failed",
        level: "error",
        error: expect.objectContaining({
          code: "REDIS_CONNECTION_ERROR",
        }),
      }),
    );
  });
});
