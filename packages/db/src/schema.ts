import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  pgEnum,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAtColumn = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const teamRoleEnum = pgEnum("team_role", [
  "owner",
  "admin",
  "operator",
  "viewer",
]);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    onboardingTeamConfirmedAt: timestamp("onboarding_team_confirmed_at", {
      withTimezone: true,
    }),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    createdAt: createdAtColumn(),
  },
  (table) => [uniqueIndex("users_email_uidx").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    billingOwnerUserId: text("billing_owner_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    createdAt: createdAtColumn(),
  },
  (table) => [uniqueIndex("teams_slug_uidx").on(table.slug)],
);

export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("team_memberships_team_user_uidx").on(
      table.teamId,
      table.userId,
    ),
  ],
);

export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: teamRoleEnum("role").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (table) => [index("team_invitations_team_id_idx").on(table.teamId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    prefix: text("prefix").notNull(),
    hashedSecret: text("hashed_secret").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("api_keys_prefix_uidx").on(table.prefix)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    repositoryUrl: text("repository_url"),
    activeDeploymentId: text("active_deployment_id"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("projects_team_slug_uidx").on(table.teamId, table.slug),
  ],
);

export const projectEnvVars = pgTable(
  "project_env_vars",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    isSecret: boolean("is_secret").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_env_vars_project_key_uidx").on(
      table.projectId,
      table.key,
    ),
  ],
);

export const sourceArtifacts = pgTable(
  "source_artifacts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id"),
    objectKey: text("object_key").notNull(),
    checksum: text("checksum").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("source_artifacts_object_key_uidx").on(table.objectKey),
  ],
);

export const builds = pgTable("builds", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id"),
  status: text("status").notNull(),
  imageRef: text("image_ref"),
  imageDigest: text("image_digest"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runtimeClass: text("runtime_class").notNull(),
    status: text("status").notNull(),
    sourceArtifactId: text("source_artifact_id"),
    buildId: text("build_id"),
    configSnapshot: jsonb("config_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
  },
  (table) => [index("deployments_project_id_idx").on(table.projectId)],
);

export const buildLogChunks = pgTable(
  "build_log_chunks",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    stream: text("stream").notNull(),
    message: text("message").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("build_log_chunks_deployment_sequence_uidx").on(
      table.deploymentId,
      table.sequence,
    ),
  ],
);

export const deploymentRoutes = pgTable(
  "deployment_routes",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    tlsEnabled: boolean("tls_enabled").notNull().default(true),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("deployment_routes_hostname_uidx").on(table.hostname),
  ],
);

export const deploymentEvents = pgTable(
  "deployment_events",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("deployment_events_deployment_id_idx").on(table.deploymentId),
  ],
);

export const metricSamples = pgTable(
  "metric_samples",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    cpuMillicores: integer("cpu_millicores"),
    memoryMb: integer("memory_mb"),
    requestCount: bigint("request_count", { mode: "number" }),
  },
  (table) => [
    index("metric_samples_deployment_timestamp_idx").on(
      table.deploymentId,
      table.timestamp,
    ),
  ],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id").references(() => deployments.id, {
      onDelete: "set null",
    }),
    meter: text("meter").notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  },
  (table) => [index("usage_records_team_id_idx").on(table.teamId)],
);

export const billingCustomers = pgTable(
  "billing_customers",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("billing_customers_team_id_uidx").on(table.teamId),
    uniqueIndex("billing_customers_stripe_customer_id_uidx").on(
      table.stripeCustomerId,
    ),
  ],
);

export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    priceId: text("price_id"),
  },
  (table) => [
    uniqueIndex("billing_subscriptions_stripe_subscription_id_uidx").on(
      table.stripeSubscriptionId,
    ),
  ],
);

export const billingInvoices = pgTable(
  "billing_invoices",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    status: text("status").notNull(),
    amountDue: integer("amount_due").notNull(),
    hostedInvoiceUrl: text("hosted_invoice_url"),
  },
  (table) => [
    uniqueIndex("billing_invoices_stripe_invoice_id_uidx").on(
      table.stripeInvoiceId,
    ),
  ],
);

export const schema = {
  apiKeys,
  billingCustomers,
  billingInvoices,
  billingSubscriptions,
  buildLogChunks,
  builds,
  deploymentEvents,
  deploymentRoutes,
  deployments,
  metricSamples,
  projectEnvVars,
  projects,
  sessions,
  sourceArtifacts,
  teamInvitations,
  teamMemberships,
  teams,
  usageRecords,
  users,
};
