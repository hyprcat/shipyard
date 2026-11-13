# Shipyard

## Build and Test

- Install dependencies with `pnpm install`.
- CI runs from `.github/workflows/quality-gates.yml` on pull requests and pushes to `main`.
- The workflow installs with `pnpm install --frozen-lockfile` and then runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` as separate steps.
- Start the web shell locally with `pnpm --filter web dev`.
- Start the control-plane locally with `set -a; source .env; set +a; (cd apps/control-plane && pnpm exec tsx -e "import('./src/index.ts').then((m) => m.default.startControlPlane())")`.
- Start the worker locally with `set -a; source .env; set +a; pnpm --filter @shipyard/worker start`.
- Validate the web production bundle with `pnpm --filter web build`.
- Workspace Vitest configs currently discover `src/**/*.test.ts`, so workspace-level tests should use `.test.ts` filenames.
- Generate SQL migration artifacts with `pnpm db:generate` after schema changes in `packages/db`.
- Apply the committed database migrations with `pnpm db:migrate` once `.env` is present and local Postgres is healthy.
- Run the full quality gates with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Root scripts validate the required pnpm workspace entries before invoking Turbo, so missing monorepo packages fail fast with a direct error.

## Local Services

- Copy `.env.example` to `.env` before running local dependencies.
- Fill in the three passwords in `.env` and put the Postgres one into `DATABASE_URL`.
- Start PostgreSQL, Redis, and MinIO with `docker compose up -d postgres redis minio`.
- Wait for all local services to report healthy with `docker compose up --wait postgres redis minio`.
