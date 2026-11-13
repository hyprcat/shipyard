import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
type WorkspaceTask = "build" | "lint" | "test" | "typecheck";

const requiredTasks = new Set<WorkspaceTask>([
  "build",
  "lint",
  "test",
  "typecheck",
]);
const requiredWorkspaces = new Set([
  "apps/control-plane",
  "apps/web",
  "apps/worker",
  "packages/config",
  "packages/db",
  "packages/ui",
  "infra/helm",
  "infra/terraform",
]);

const requestedTask = process.argv[2];
const workspace = relative(rootDir, process.cwd());

if (!requiredTasks.has(requestedTask as WorkspaceTask)) {
  console.error(`Unsupported workspace task "${requestedTask}".`);
  process.exit(1);
}

const task = requestedTask as WorkspaceTask;

if (!requiredWorkspaces.has(workspace)) {
  console.error(`Unexpected workspace path "${workspace}".`);
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
);

if (!manifest.name) {
  console.error(`Workspace "${workspace}" is missing a package name.`);
  process.exit(1);
}

const requiredFilesByTask = {
  build: ["src/id.ts", "src/index.ts", "tsconfig.json"],
  lint: ["eslint.config.mjs", "src/id.ts", "src/index.ts", "tsconfig.json"],
  test: ["vitest.config.mjs"],
  typecheck: ["src/id.ts", "src/index.ts", "tsconfig.json"],
} satisfies Record<WorkspaceTask, string[]>;

const commands = {
  build: ["exec", "tsc", "-p", "tsconfig.json", "--noEmit"],
  lint: [
    "exec",
    "eslint",
    "--config",
    "eslint.config.mjs",
    "src/**/*.{ts,tsx}",
  ],
  test: [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.mjs",
    "--passWithNoTests",
  ],
  typecheck: ["exec", "tsc", "-p", "tsconfig.json", "--noEmit"],
} satisfies Record<WorkspaceTask, string[]>;

for (const file of requiredFilesByTask[task]) {
  if (!existsSync(join(process.cwd(), file))) {
    console.error(
      `Workspace "${workspace}" is missing required file "${file}".`,
    );
    process.exit(1);
  }
}

console.log(`[${task}] ${manifest.name}`);

const result = spawnSync("pnpm", commands[task], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
