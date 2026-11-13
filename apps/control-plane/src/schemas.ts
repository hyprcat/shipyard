export type HealthResponse = {
  ok: true;
  service: "control-plane";
};

export type EchoQuerystring = {
  message: string;
};

export type EchoResponse = {
  ok: true;
  message: string;
  session: string | null;
};

export type RegisterRequestBody = {
  email: string;
  password: string;
};

export type AuthenticatedResponse = {
  ok: true;
  session: {
    createdAt: Date;
    expiresAt: Date;
    id: string;
    userId: string;
  };
  user: {
    createdAt: Date;
    email: string;
    id: string;
    onboardingCompletedAt: Date | null;
  };
};

export type RegisterResponse = AuthenticatedResponse;
export type LoginResponse = AuthenticatedResponse;
export type CurrentSessionResponse = AuthenticatedResponse;

export type LogoutResponse = {
  ok: true;
};

type TeamMember = {
  acceptedAt: Date | null;
  email: string;
  id: string;
  invitedAt: Date;
  role: string;
  userId: string;
};

type TeamInvitation = {
  email: string;
  expiresAt: Date;
  id: string;
  invitedAt: Date;
  role: string;
  status: "expired" | "pending";
};

export type TeamMembersResponse = {
  currentUserRole: string;
  invitations: TeamInvitation[];
  members: TeamMember[];
  ok: true;
};

export type TeamInvitationResponse = {
  invitation: TeamInvitation;
  ok: true;
};

export type TeamMemberResponse = {
  member: TeamMember;
  ok: true;
};

type OnboardingStep = "team" | "apiKey" | "project" | "complete";

export type OnboardingState = {
  apiKeyCount: number;
  firstIncompleteStep: OnboardingStep;
  onboardingCompletedAt: Date | null;
  onboardingTeamConfirmedAt: Date | null;
  projectCount: number;
  team: {
    id: string;
    name: string;
    slug: string;
  };
};

export type OnboardingStateResponse = {
  ok: true;
  state: OnboardingState;
};

export type OnboardingApiKeyResponse = {
  apiKey: {
    id: string;
    label: string;
    prefix: string;
    secret: string;
  };
  ok: true;
  state: OnboardingState;
};

type ProjectSummary = {
  createdAt: Date;
  id: string;
  name: string;
  slug: string;
};

export type OnboardingProjectResponse = {
  ok: true;
  project: ProjectSummary;
  state: OnboardingState;
};

export type ProjectsResponse = {
  ok: true;
  projects: ProjectSummary[];
};

export type TeamParams = {
  teamId: string;
};

export type TeamMemberParams = TeamParams & {
  membershipId: string;
};

export type InviteMemberRequestBody = {
  email: string;
  role: string;
};

export type UpdateTeamMemberRoleRequestBody = {
  role: string;
};

export type OnboardingTeamRequestBody = {
  name: string;
};

export type OnboardingApiKeyRequestBody = {
  label: string;
};

export type OnboardingProjectRequestBody = {
  name: string;
};

export type ErrorDetail = {
  message: string;
  path: string;
};

export type ErrorResponse = {
  ok: false;
  error: {
    code:
      | "AUTHORIZATION_ERROR"
      | "INTERNAL_SERVER_ERROR"
      | "REQUEST_ERROR"
      | "VALIDATION_ERROR";
    details?: ErrorDetail[];
    message: string;
    statusCode: number;
  };
};

export type ValidationIssue = {
  instancePath?: string;
  message?: string;
  params?: {
    missingProperty?: string;
  };
};

export const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "service"],
  properties: {
    ok: { type: "boolean" },
    service: { type: "string" },
  },
} as const;

export const echoQuerystringSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1 },
  },
} as const;

export const echoResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "message", "session"],
  properties: {
    ok: { type: "boolean" },
    message: { type: "string" },
    session: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
} as const;

export const registerBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "password"],
  properties: {
    email: {
      type: "string",
      maxLength: 320,
      pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    },
    password: {
      type: "string",
      minLength: 8,
      maxLength: 256,
    },
  },
} as const;

const authUserResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "email", "createdAt", "onboardingCompletedAt"],
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    createdAt: { type: "string" },
    onboardingCompletedAt: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
} as const;

const authSessionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "userId", "createdAt", "expiresAt"],
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    createdAt: { type: "string" },
    expiresAt: { type: "string" },
  },
} as const;

export const authenticatedResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "user", "session"],
  properties: {
    ok: { type: "boolean" },
    user: authUserResponseSchema,
    session: authSessionResponseSchema,
  },
} as const;

export const logoutResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
  },
} as const;

export const teamParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["teamId"],
  properties: {
    teamId: { type: "string", minLength: 1 },
  },
} as const;

export const teamMemberParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["membershipId", "teamId"],
  properties: {
    membershipId: { type: "string", minLength: 1 },
    teamId: { type: "string", minLength: 1 },
  },
} as const;

export const inviteMemberBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "role"],
  properties: {
    email: registerBodySchema.properties.email,
    role: {
      type: "string",
      enum: ["owner", "admin", "operator", "viewer"],
    },
  },
} as const;

export const updateTeamMemberRoleBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["role"],
  properties: {
    role: inviteMemberBodySchema.properties.role,
  },
} as const;

const onboardingStepSchema = {
  type: "string",
  enum: ["team", "apiKey", "project", "complete"],
} as const;

const onboardingStateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "apiKeyCount",
    "firstIncompleteStep",
    "onboardingCompletedAt",
    "onboardingTeamConfirmedAt",
    "projectCount",
    "team",
  ],
  properties: {
    apiKeyCount: { type: "number" },
    firstIncompleteStep: onboardingStepSchema,
    onboardingCompletedAt: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    onboardingTeamConfirmedAt: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    projectCount: { type: "number" },
    team: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "slug"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        slug: { type: "string" },
      },
    },
  },
} as const;

export const onboardingStateResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "state"],
  properties: {
    ok: { type: "boolean" },
    state: onboardingStateSchema,
  },
} as const;

export const onboardingTeamBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: {
      type: "string",
      minLength: 2,
      maxLength: 64,
    },
  },
} as const;

export const onboardingApiKeyBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["label"],
  properties: {
    label: {
      type: "string",
      minLength: 2,
      maxLength: 64,
    },
  },
} as const;

export const onboardingProjectBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: {
      type: "string",
      minLength: 2,
      maxLength: 64,
    },
  },
} as const;

const projectSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["createdAt", "id", "name", "slug"],
  properties: {
    createdAt: { type: "string" },
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
  },
} as const;

export const onboardingApiKeyResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["apiKey", "ok", "state"],
  properties: {
    apiKey: {
      type: "object",
      additionalProperties: false,
      required: ["id", "label", "prefix", "secret"],
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        prefix: { type: "string" },
        secret: { type: "string" },
      },
    },
    ok: { type: "boolean" },
    state: onboardingStateSchema,
  },
} as const;

export const onboardingProjectResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "project", "state"],
  properties: {
    ok: { type: "boolean" },
    project: projectSummarySchema,
    state: onboardingStateSchema,
  },
} as const;

export const projectsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "projects"],
  properties: {
    ok: { type: "boolean" },
    projects: {
      type: "array",
      items: projectSummarySchema,
    },
  },
} as const;
