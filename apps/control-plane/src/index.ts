import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { loadControlPlaneEnv, type ControlPlaneEnv } from "@shipyard/config";
import { createDatabase, type DatabaseConnection } from "@shipyard/db";
import fastifyPlugin from "fastify-plugin";
import Fastify, { type FastifyInstance } from "fastify";
import { createAuthService, type AuthService } from "./auth";
import { createApiKeyService, type ApiKeyService } from "./api-key-service";
import {
  createOnboardingService,
  type OnboardingService,
} from "./onboarding-service";
import { createTeamService, type TeamService } from "./team-service";
import { setStructuredErrorHandler } from "./errors";
import { routes } from "./routes";

// Keep the shared workspace marker for scripts/validate-workspaces.ts: from "@/id"
export { id } from "./id";
export * from "./auth";
export * from "./api-key-service";
export * from "./onboarding-service";
export * from "./team-service";

export type BindServer = (
  app: FastifyInstance,
  env: ControlPlaneEnv,
) => void | string | Promise<string | void>;

export interface BuildControlPlaneOptions {
  apiKeyService?: ApiKeyService;
  authService?: AuthService;
  database?: DatabaseConnection;
  onboardingService?: OnboardingService;
  teamService?: TeamService;
}

export const buildControlPlane = (
  env: Record<string, string | undefined> = process.env,
  options: BuildControlPlaneOptions = {},
): { app: FastifyInstance; env: ControlPlaneEnv } => {
  const config = loadControlPlaneEnv(env);
  const app = Fastify({
    logger: false,
  });
  const database =
    options.database ??
    (options.apiKeyService ||
    options.authService ||
    options.onboardingService ||
    options.teamService
      ? undefined
      : createDatabase(config.databaseUrl));
  const apiKeyService =
    options.apiKeyService ??
    (database
      ? createApiKeyService({ db: database.db })
      : {
          authenticateApiKey: async () => {
            throw new Error("API key service is not configured");
          },
          createBootstrapSuperuserApiKey: async () => {
            throw new Error("API key service is not configured");
          },
          createTeamApiKey: async () => {
            throw new Error("API key service is not configured");
          },
        });
  const authService =
    options.authService ?? createAuthService({ db: database!.db });
  const onboardingService =
    options.onboardingService ??
    (database
      ? createOnboardingService({ apiKeyService, db: database.db })
      : {
          confirmTeam: async () => {
            throw new Error("Onboarding service is not configured");
          },
          createApiKey: async () => {
            throw new Error("Onboarding service is not configured");
          },
          createProject: async () => {
            throw new Error("Onboarding service is not configured");
          },
          getState: async () => {
            throw new Error("Onboarding service is not configured");
          },
          listProjects: async () => {
            throw new Error("Onboarding service is not configured");
          },
          listProjectsByTeam: async () => {
            throw new Error("Onboarding service is not configured");
          },
        });
  const teamService =
    options.teamService ??
    (database
      ? createTeamService({ db: database.db })
      : {
          inviteMember: async () => {
            throw new Error("Team service is not configured");
          },
          listMembers: async () => {
            throw new Error("Team service is not configured");
          },
          removeMember: async () => {
            throw new Error("Team service is not configured");
          },
          updateMemberRole: async () => {
            throw new Error("Team service is not configured");
          },
        });

  setStructuredErrorHandler(app);
  if (database) {
    app.addHook("onClose", async () => {
      await database.pool.end();
    });
  }
  app.register(fastifyPlugin(cors), {
    credentials: true,
    origin: true,
  });
  app.register(fastifyPlugin(cookie));
  app.register(
    routes({ apiKeyService, authService, onboardingService, teamService }),
  );

  return { app, env: config };
};

const resolvePort = (env: Record<string, string | undefined>): number => {
  const port = Number.parseInt(env.PORT ?? "3000", 10);

  return Number.isNaN(port) ? 3000 : port;
};

export const startControlPlane = async (
  env: Record<string, string | undefined> = process.env,
  bindServer: BindServer = (app) =>
    app.listen({
      host: "0.0.0.0",
      port: resolvePort(env),
    }),
  options: BuildControlPlaneOptions = {},
): Promise<{ app: FastifyInstance; env: ControlPlaneEnv }> => {
  const controlPlane = buildControlPlane(env, options);

  try {
    await bindServer(controlPlane.app, controlPlane.env);
    return controlPlane;
  } catch (error) {
    await controlPlane.app.close();
    throw error;
  }
};

if (import.meta.main) {
  void startControlPlane().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
