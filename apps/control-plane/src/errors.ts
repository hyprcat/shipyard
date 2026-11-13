import { type FastifyError, type FastifyInstance } from "fastify";
import { AuthError } from "./auth";
import { OnboardingServiceError } from "./onboarding-service";
import { TeamServiceError } from "./team-service";
import {
  type ErrorDetail,
  type ErrorResponse,
  type ValidationIssue,
} from "./schemas";

const normalizeValidationPath = (issue: ValidationIssue): string => {
  if (issue.instancePath && issue.instancePath.length > 0) {
    return issue.instancePath.replace(/^\//, "").replaceAll("/", ".");
  }

  return issue.params?.missingProperty ?? "request";
};

const createValidationErrorResponse = (
  details: ErrorDetail[],
  statusCode = 400,
): ErrorResponse => ({
  ok: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
    statusCode,
    details,
  },
});

export const setStructuredErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const validationIssues = (
      error as FastifyError & { validation?: ValidationIssue[] }
    ).validation;

    if (validationIssues) {
      reply.status(400).send(
        createValidationErrorResponse(
          validationIssues.map((issue) => ({
            message: issue.message ?? "Invalid request",
            path: normalizeValidationPath(issue),
          })),
        ),
      );
      return;
    }

    if (error instanceof AuthError) {
      if (error.code === "DUPLICATE_EMAIL") {
        reply.status(error.statusCode).send(
          createValidationErrorResponse(
            [
              {
                message: error.message,
                path: "email",
              },
            ],
            error.statusCode,
          ),
        );
        return;
      }

      reply.status(error.statusCode).send({
        ok: false,
        error: {
          code: "REQUEST_ERROR",
          message: error.message,
          statusCode: error.statusCode,
        },
      } satisfies ErrorResponse);
      return;
    }

    if (error instanceof TeamServiceError) {
      reply.status(error.statusCode).send({
        ok: false,
        error: {
          code:
            error.code === "AUTHORIZATION_ERROR"
              ? "AUTHORIZATION_ERROR"
              : "REQUEST_ERROR",
          message: error.message,
          statusCode: error.statusCode,
        },
      } satisfies ErrorResponse);
      return;
    }

    if (error instanceof OnboardingServiceError) {
      reply.status(error.statusCode).send({
        ok: false,
        error: {
          code:
            error.code === "AUTHORIZATION_ERROR"
              ? "AUTHORIZATION_ERROR"
              : "REQUEST_ERROR",
          message: error.message,
          statusCode: error.statusCode,
        },
      } satisfies ErrorResponse);
      return;
    }

    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;

    reply.status(statusCode).send({
      ok: false,
      error: {
        code: statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR",
        message: statusCode >= 500 ? "Internal server error" : error.message,
        statusCode,
      },
    } satisfies ErrorResponse);
  });
};
