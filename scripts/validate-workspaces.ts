import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const requiredTasks = ["build", "lint", "test", "typecheck"];
const requiredTools = [
  "@typescript-eslint/eslint-plugin",
  "@typescript-eslint/parser",
  "@types/node",
  "eslint",
  "prettier",
  "tsx",
  "turbo",
  "typescript",
  "vitest",
];
const requiredRootFiles = [
  "eslint.config.mjs",
  "prettier.config.mjs",
  "tsconfig.base.json",
  "tsconfig.package.json",
  "vitest.config.mjs",
];
const requiredWorkspaces = [
  "apps/control-plane",
  "apps/web",
  "apps/worker",
  "packages/config",
  "packages/db",
  "packages/ui",
  "infra/helm",
  "infra/terraform",
];
const requiredWorkspaceFiles = [
  "eslint.config.mjs",
  "src/id.ts",
  "src/index.ts",
  "tsconfig.json",
  "vitest.config.mjs",
];
const requiredWorkspaceReferences = [
  {
    file: "eslint.config.mjs",
    fragment: "createWorkspaceEslintConfig(import.meta.dirname)",
  },
  {
    file: "src/index.ts",
    fragment: 'from "@/id"',
  },
  {
    file: "tsconfig.json",
    fragment: '"baseUrl": "."',
  },
  {
    file: "tsconfig.json",
    fragment: '"extends": "../../tsconfig.package.json"',
  },
  {
    file: "vitest.config.mjs",
    fragment: 'export { default } from "../../vitest.config.mjs";',
  },
];

const task = process.argv[2];
const rootPackage = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf8"),
);
const workspaceText = readFileSync(
  join(rootDir, "pnpm-workspace.yaml"),
  "utf8",
);
const patterns = [
  ...workspaceText.matchAll(/-\s*["']?([^"'\n]+)["']?\s*$/gm),
].map((match) => match[1].trim());
const issues = [];

const matchesPattern = (pattern: string, workspace: string) => {
  const patternParts = pattern.split("/");
  const workspaceParts = workspace.split("/");

  return (
    patternParts.length === workspaceParts.length &&
    patternParts.every(
      (part: string, index: number) =>
        part === "*" || part === workspaceParts[index],
    )
  );
};

if (task && !requiredTasks.includes(task)) {
  issues.push(
    `Unsupported task "${task}". Expected one of: ${requiredTasks.join(", ")}.`,
  );
}

for (const tool of requiredTools) {
  if (!rootPackage.devDependencies?.[tool]) {
    issues.push(`Root devDependency "${tool}" is missing from package.json.`);
  }
}

for (const file of requiredRootFiles) {
  if (!existsSync(join(rootDir, file))) {
    issues.push(`Root config file is missing: ${file}.`);
  }
}

for (const workspace of requiredWorkspaces) {
  if (!patterns.some((pattern) => matchesPattern(pattern, workspace))) {
    issues.push(
      `Workspace entry missing for "${workspace}" in pnpm-workspace.yaml.`,
    );
  }

  const manifestPath = join(rootDir, workspace, "package.json");

  if (!existsSync(manifestPath)) {
    issues.push(`Workspace manifest missing: ${workspace}/package.json.`);
    continue;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  for (const requiredTask of requiredTasks) {
    if (!manifest.scripts?.[requiredTask]) {
      issues.push(
        `Workspace "${workspace}" is missing the "${requiredTask}" script.`,
      );
    }
  }

  for (const file of requiredWorkspaceFiles) {
    const filePath = join(rootDir, workspace, file);

    if (!existsSync(filePath)) {
      issues.push(`Workspace "${workspace}" is missing "${file}".`);
    }
  }

  for (const reference of requiredWorkspaceReferences) {
    const filePath = join(rootDir, workspace, reference.file);

    if (!existsSync(filePath)) {
      continue;
    }

    const fileContents = readFileSync(filePath, "utf8");

    if (!fileContents.includes(reference.fragment)) {
      issues.push(
        `Workspace "${workspace}" must reference the shared config in "${reference.file}".`,
      );
    }
  }
}

if (issues.length > 0) {
  console.error("Workspace validation failed:");

  for (const issue of issues) {
    console.error(`- ${issue}`);
  }

  process.exit(1);
}

console.log(`Workspace validation passed${task ? ` for ${task}` : ""}.`);
