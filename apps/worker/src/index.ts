import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Queue, QueueEvents, Worker, type Job } from "bullmq";
import { loadWorkerEnv, type WorkerEnv } from "@shipyard/config";
import IORedis, { type Redis, type RedisOptions } from "ioredis";

// Keep the shared workspace marker for scripts/validate-workspaces.ts: from "@/id"
export { id } from "./id";

export const defaultQueueName = "shipyard.jobs";

export type ShipyardJobPayloadMap = {
  noop: {
    source: string;
  };
  build: {
    deploymentId: string;
    projectId: string;
  };
  reconcile: {
    deploymentId: string;
    reason: string;
  };
  billing: {
    billingPeriod: string;
    teamId: string;
  };
};

export type ShipyardJobResultMap = {
  noop: {
    handledBy: "noop";
    ok: true;
    source: string;
  };
  build: {
    deploymentId: string;
    handledBy: "build";
    ok: true;
    projectId: string;
  };
  reconcile: {
    deploymentId: string;
    handledBy: "reconcile";
    ok: true;
    reason: string;
  };
  billing: {
    billingPeriod: string;
    handledBy: "billing";
    ok: true;
    teamId: string;
  };
};

export type ShipyardJobName = keyof ShipyardJobPayloadMap;
export type ShipyardJob<Name extends ShipyardJobName = ShipyardJobName> = Job<
  ShipyardJobPayloadMap[Name],
  ShipyardJobResultMap[Name],
  Name
>;
export type ShipyardJobHandler<Name extends ShipyardJobName = ShipyardJobName> =
  (job: ShipyardJob<Name>) => Promise<ShipyardJobResultMap[Name]>;
export type ShipyardJobHandlers = {
  [Name in ShipyardJobName]: ShipyardJobHandler<Name>;
};

export type WorkerInfoEvent =
  | {
      event: "worker.job.completed";
      jobId: string | null;
      jobName: string | null;
      level: "info";
      queueName: string;
    }
  | {
      event: "worker.shutdown.requested";
      level: "info";
      queueName: string;
      signal: NodeJS.Signals;
    }
  | {
      event: "worker.started" | "worker.stopped";
      level: "info";
      queueName: string;
      redisUrl: string;
    };

export type WorkerErrorCode =
  | "JOB_FAILED"
  | "REDIS_CONNECTION_ERROR"
  | "UNKNOWN_JOB";

export type WorkerErrorEvent = {
  error: {
    cause: string | null;
    code: WorkerErrorCode;
    message: string;
    name: string;
  };
  event: "worker.connection.failed" | "worker.job.failed";
  jobId: string | null;
  jobName: string | null;
  level: "error";
  queueName: string;
};

export type WorkerLogger = {
  error: (entry: WorkerErrorEvent) => void;
  info: (entry: WorkerInfoEvent) => void;
};

export type StartWorkerOptions = {
  handlers?: Partial<ShipyardJobHandlers>;
  logger?: WorkerLogger;
  queueName?: string;
  redisOptions?: RedisOptions;
  registerShutdownHooks?: boolean;
  signalSource?: NodeJS.Process;
};

export type WorkerRuntime = {
  close: () => Promise<void>;
  env: WorkerEnv;
  logger: WorkerLogger;
  queue: Queue;
  queueEvents: QueueEvents;
  queueName: string;
  worker: Worker;
};

const defaultWorkerLogger: WorkerLogger = {
  info: (entry) => {
    console.log(JSON.stringify(entry));
  },
  error: (entry) => {
    console.error(JSON.stringify(entry));
  },
};

const defaultJobHandlers = {
  noop: async (job) => ({
    handledBy: "noop",
    ok: true,
    source: job.data.source,
  }),
  build: async (job) => ({
    deploymentId: job.data.deploymentId,
    handledBy: "build",
    ok: true,
    projectId: job.data.projectId,
  }),
  reconcile: async (job) => ({
    deploymentId: job.data.deploymentId,
    handledBy: "reconcile",
    ok: true,
    reason: job.data.reason,
  }),
  billing: async (job) => ({
    billingPeriod: job.data.billingPeriod,
    handledBy: "billing",
    ok: true,
    teamId: job.data.teamId,
  }),
} satisfies ShipyardJobHandlers;

class WorkerRuntimeError extends Error {
  readonly code: WorkerErrorCode;

  constructor(code: WorkerErrorCode, message: string, cause?: unknown) {
    super(message, {
      cause,
    });

    this.code = code;
    this.name = "WorkerRuntimeError";
  }
}

const defaultRedisOptions: RedisOptions = {
  connectTimeout: 500,
  lazyConnect: true,
  maxRetriesPerRequest: null,
  retryStrategy: (attempt) => (attempt > 1 ? null : 50),
};

const createRedisConnection = (
  redisUrl: string,
  redisOptions: RedisOptions = {},
): Redis => {
  const connection = new IORedis(redisUrl, {
    ...defaultRedisOptions,
    ...redisOptions,
  });

  // BullMQ surfaces its own structured failures; swallow raw ioredis error
  // events so startup failure tests do not leak unhandled rejections.
  connection.on("error", () => {});

  return connection;
};

const closeRedisConnection = async (connection: Redis): Promise<void> => {
  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
};

const asMessage = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }

  return String(value);
};

const createWorkerErrorEvent = (
  event: WorkerErrorEvent["event"],
  queueName: string,
  error: unknown,
  job?: Pick<Job, "id" | "name">,
): WorkerErrorEvent => {
  const workerError =
    error instanceof WorkerRuntimeError
      ? error
      : new WorkerRuntimeError("JOB_FAILED", asMessage(error), error);
  const cause = workerError.cause;

  return {
    error: {
      cause: cause ? asMessage(cause) : null,
      code: workerError.code,
      message: workerError.message,
      name: workerError.name,
    },
    event,
    jobId: job?.id ?? null,
    jobName: job?.name ?? null,
    level: "error",
    queueName,
  };
};

const redactRedisUrl = (redisUrl: string): string => {
  const parsedUrl = new URL(redisUrl);

  if (parsedUrl.username || parsedUrl.password) {
    parsedUrl.username = "redacted";
    parsedUrl.password = "redacted";
  }

  return parsedUrl.toString();
};

const createJobProcessor =
  (handlers: ShipyardJobHandlers) =>
  async (job: Job): Promise<unknown> => {
    switch (job.name) {
      case "noop":
        return handlers.noop(job as ShipyardJob<"noop">);
      case "build":
        return handlers.build(job as ShipyardJob<"build">);
      case "reconcile":
        return handlers.reconcile(job as ShipyardJob<"reconcile">);
      case "billing":
        return handlers.billing(job as ShipyardJob<"billing">);
      default:
        throw new WorkerRuntimeError(
          "UNKNOWN_JOB",
          `No handler registered for job "${job.name}"`,
        );
    }
  };

export const installShutdownHooks = (
  close: () => Promise<void>,
  logger: WorkerLogger,
  queueName: string,
  redisUrl: string,
  signalSource: NodeJS.Process = process,
): (() => void) => {
  const handleSignal = (signal: NodeJS.Signals): void => {
    logger.info({
      event: "worker.shutdown.requested",
      level: "info",
      queueName,
      signal,
    });

    void close().catch((error: unknown) => {
      logger.error(
        createWorkerErrorEvent(
          "worker.connection.failed",
          queueName,
          new WorkerRuntimeError(
            "REDIS_CONNECTION_ERROR",
            `Worker shutdown failed for queue "${queueName}" on ${redactRedisUrl(redisUrl)}`,
            error,
          ),
        ),
      );
      signalSource.exitCode = 1;
    });
  };

  signalSource.once("SIGINT", handleSignal);
  signalSource.once("SIGTERM", handleSignal);

  return () => {
    signalSource.off("SIGINT", handleSignal);
    signalSource.off("SIGTERM", handleSignal);
  };
};

const installWorkerListeners = (
  worker: Worker,
  queueName: string,
  logger: WorkerLogger,
): void => {
  worker.on("completed", (job) => {
    logger.info({
      event: "worker.job.completed",
      jobId: job.id ?? null,
      jobName: job.name ?? null,
      level: "info",
      queueName,
    });
  });

  worker.on("failed", (job, error) => {
    logger.error(
      createWorkerErrorEvent("worker.job.failed", queueName, error, job),
    );
  });

  worker.on("error", (error) => {
    logger.error(
      createWorkerErrorEvent(
        "worker.connection.failed",
        queueName,
        new WorkerRuntimeError(
          "REDIS_CONNECTION_ERROR",
          `Worker connection failed for queue "${queueName}"`,
          error,
        ),
      ),
    );
  });
};

const installQueueEventListeners = (
  queueEvents: QueueEvents,
  queueName: string,
  logger: WorkerLogger,
): void => {
  const handleError = (error: Error): void => {
    logger.error(
      createWorkerErrorEvent(
        "worker.connection.failed",
        queueName,
        new WorkerRuntimeError(
          "REDIS_CONNECTION_ERROR",
          `Queue events connection failed for queue "${queueName}"`,
          error,
        ),
      ),
    );
  };

  queueEvents.on("error", handleError);
};

export const startWorker = async (
  envValues: Record<string, string | undefined> = process.env,
  options: StartWorkerOptions = {},
): Promise<WorkerRuntime> => {
  const env = loadWorkerEnv(envValues);
  const logger = options.logger ?? defaultWorkerLogger;
  const queueName = options.queueName ?? defaultQueueName;
  const redisUrl = redactRedisUrl(env.redisUrl);
  const queueConnection = createRedisConnection(
    env.redisUrl,
    options.redisOptions,
  );
  const workerConnection = createRedisConnection(
    env.redisUrl,
    options.redisOptions,
  );
  const queueEventsConnection = createRedisConnection(
    env.redisUrl,
    options.redisOptions,
  );
  try {
    await Promise.all([
      queueConnection.connect(),
      workerConnection.connect(),
      queueEventsConnection.connect(),
    ]);
    await Promise.all([
      queueConnection.ping(),
      workerConnection.ping(),
      queueEventsConnection.ping(),
    ]);
  } catch (error) {
    const startupError = new WorkerRuntimeError(
      "REDIS_CONNECTION_ERROR",
      `Worker could not connect to Redis for queue "${queueName}" on ${redisUrl}`,
      error,
    );

    logger.error(
      createWorkerErrorEvent(
        "worker.connection.failed",
        queueName,
        startupError,
      ),
    );
    await Promise.allSettled([
      closeRedisConnection(workerConnection),
      closeRedisConnection(queueConnection),
      closeRedisConnection(queueEventsConnection),
    ]);
    throw startupError;
  }

  const queue = new Queue(queueName, {
    connection: queueConnection,
  });
  const queueEvents = new QueueEvents(queueName, {
    connection: queueEventsConnection,
  });
  const worker = new Worker(
    queueName,
    createJobProcessor({
      ...defaultJobHandlers,
      ...options.handlers,
    }),
    {
      connection: workerConnection,
    },
  );

  let started = false;
  let closed = false;
  let removeShutdownHooks = (): void => {};
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }

    closed = true;
    removeShutdownHooks();
    await Promise.allSettled([
      worker.close(),
      queueEvents.close(),
      queue.close(),
    ]);
    await Promise.allSettled([
      closeRedisConnection(workerConnection),
      closeRedisConnection(queueConnection),
      closeRedisConnection(queueEventsConnection),
    ]);

    if (started) {
      logger.info({
        event: "worker.stopped",
        level: "info",
        queueName,
        redisUrl,
      });
    }
  };

  installWorkerListeners(worker, queueName, logger);
  installQueueEventListeners(queueEvents, queueName, logger);

  try {
    await Promise.all([
      queue.waitUntilReady(),
      queueEvents.waitUntilReady(),
      worker.waitUntilReady(),
    ]);

    if (options.registerShutdownHooks) {
      removeShutdownHooks = installShutdownHooks(
        close,
        logger,
        queueName,
        env.redisUrl,
        options.signalSource,
      );
    }

    started = true;
    logger.info({
      event: "worker.started",
      level: "info",
      queueName,
      redisUrl,
    });

    return {
      close,
      env,
      logger,
      queue,
      queueEvents,
      queueName,
      worker,
    };
  } catch (error) {
    const startupError = new WorkerRuntimeError(
      "REDIS_CONNECTION_ERROR",
      `Worker could not connect to Redis for queue "${queueName}" on ${redisUrl}`,
      error,
    );

    logger.error(
      createWorkerErrorEvent(
        "worker.connection.failed",
        queueName,
        startupError,
      ),
    );
    await close();
    throw startupError;
  }
};

export const enqueueShipyardJob = async <Name extends ShipyardJobName>(
  queue: Queue,
  name: Name,
  data: ShipyardJobPayloadMap[Name],
): Promise<ShipyardJob<Name>> =>
  queue.add(name, data) as Promise<ShipyardJob<Name>>;

export const waitForShipyardJob = async <Name extends ShipyardJobName>(
  job: ShipyardJob<Name>,
  queueEvents: QueueEvents,
  ttl = 5_000,
): Promise<ShipyardJobResultMap[Name]> =>
  job.waitUntilFinished(queueEvents, ttl) as Promise<
    ShipyardJobResultMap[Name]
  >;

export const runLocalNoopJob = async (
  envValues: Record<string, string | undefined> = process.env,
  options: Omit<StartWorkerOptions, "registerShutdownHooks"> = {},
): Promise<ShipyardJobResultMap["noop"]> => {
  const runtime = await startWorker(envValues, options);

  try {
    const job = await enqueueShipyardJob(runtime.queue, "noop", {
      source: "local-smoke-test",
    });
    const result = await waitForShipyardJob(job, runtime.queueEvents);

    await job.remove();
    return result;
  } finally {
    await runtime.close();
  }
};

const isMainModule = (): boolean => {
  const entrypoint = process.argv[1];

  return entrypoint
    ? resolve(entrypoint) === fileURLToPath(import.meta.url)
    : false;
};

if (isMainModule()) {
  const keepAlive: {
    runtime: WorkerRuntime | undefined;
  } = {
    runtime: undefined,
  };

  void startWorker(process.env, {
    registerShutdownHooks: true,
  })
    .then((startedRuntime) => {
      keepAlive.runtime = startedRuntime;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
