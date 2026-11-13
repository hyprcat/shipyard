import { type FormEvent, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Input } from "@shipyard/ui";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  type AuthMode,
  type AuthenticatedResponse,
  type FieldErrors,
  authNoticeMessages,
  authPageContent,
  authQueryKey,
  buildAuthPath,
  defaultAuthRedirects,
  isApiError,
  mapFieldErrors,
  normalizeRedirectTo,
  requestJson,
  validateAuthForm,
} from "./api";

export const AuthPage = ({ mode }: { readonly mode: AuthMode }) => {
  const content = authPageContent[mode];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTo = normalizeRedirectTo(searchParams.get("redirectTo"));
  const defaultDestination = defaultAuthRedirects[mode];
  const destination = redirectTo ?? defaultDestination;
  const guardMessage =
    authNoticeMessages[
      searchParams.get("reason") as keyof typeof authNoticeMessages
    ] ?? null;

  useEffect(() => {
    setFieldErrors({});
    setFormError(guardMessage);
  }, [guardMessage, mode]);

  const alternatePath = buildAuthPath(
    mode === "login" ? "/register" : "/login",
    redirectTo,
  );
  const showNotice = formError !== null;

  const handleChange = (field: "email" | "password", value: string): void => {
    if (field === "email") {
      setEmail(value);
    } else {
      setPassword(value);
    }

    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      return {
        ...current,
        [field]: undefined,
      };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextFieldErrors = validateAuthForm({ email, password });

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setFormError("Fix the highlighted fields and try again.");
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const response = await requestJson<AuthenticatedResponse>(
        mode === "login" ? "/api/auth/login" : "/api/auth/register",
        {
          body: JSON.stringify({ email, password }),
          method: "POST",
        },
      );

      queryClient.setQueryData(authQueryKey, response);
      navigate(destination, { replace: true });
    } catch (error) {
      if (isApiError(error)) {
        const nextApiFieldErrors = mapFieldErrors(error.details);

        setFieldErrors(nextApiFieldErrors);
        setFormError(
          Object.keys(nextApiFieldErrors).length > 0
            ? "Fix the highlighted fields and try again."
            : error.message,
        );
      } else {
        setFormError("Unable to reach Shipyard. Try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-layout">
        <section className="panel auth-hero">
          <div className="badge-row">
            <Badge tone={content.badgeTone}>
              {mode === "login" ? "Session gate" : "Workspace bootstrap"}
            </Badge>
            {redirectTo ? (
              <span className="query-key">Return after auth: {redirectTo}</span>
            ) : null}
          </div>

          <h1 className="shell-title">{content.title}</h1>
          <p className="shell-copy">{content.summary}</p>

          <ul className="highlight-list">
            {content.callouts.map((callout) => (
              <li key={callout}>{callout}</li>
            ))}
          </ul>

          <div className="auth-hero-actions">
            <Button onClick={() => navigate("/")} tone="secondary">
              Back home
            </Button>
            <Button onClick={() => navigate(alternatePath)} tone="secondary">
              {content.switchAction}
            </Button>
          </div>
        </section>

        <Card className="auth-card">
          <div className="auth-card-header">
            <h2 className="detail-title">Email and password</h2>
            <p className="detail-copy">
              {mode === "login"
                ? "Use the same credentials issued during registration."
                : "Your session starts immediately after registration succeeds."}
            </p>
          </div>

          {showNotice ? (
            <p
              className={
                formError === guardMessage
                  ? "inline-notice"
                  : "inline-notice inline-notice--danger"
              }
              role="alert"
            >
              {formError}
            </p>
          ) : null}

          <form className="auth-form" noValidate onSubmit={handleSubmit}>
            <label className="field-label">
              Work email
              <Input
                aria-describedby={
                  fieldErrors.email ? "auth-email-error" : undefined
                }
                aria-invalid={fieldErrors.email ? "true" : undefined}
                autoComplete="email"
                name="email"
                onChange={(event) => handleChange("email", event.target.value)}
                placeholder="owner@shipyard.local"
                required
                type="email"
                value={email}
              />
              {fieldErrors.email ? (
                <span className="field-error" id="auth-email-error">
                  {fieldErrors.email}
                </span>
              ) : null}
            </label>

            <label className="field-label">
              Password
              <Input
                aria-describedby={
                  fieldErrors.password ? "auth-password-error" : undefined
                }
                aria-invalid={fieldErrors.password ? "true" : undefined}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={8}
                name="password"
                onChange={(event) =>
                  handleChange("password", event.target.value)
                }
                placeholder="Minimum 8 characters"
                required
                type="password"
                value={password}
              />
              {fieldErrors.password ? (
                <span className="field-error" id="auth-password-error">
                  {fieldErrors.password}
                </span>
              ) : (
                <span className="field-help">Use at least 8 characters.</span>
              )}
            </label>

            <Button
              className="auth-submit"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? content.pendingLabel : content.submitLabel}
            </Button>
          </form>

          <div className="auth-switch">
            <p className="detail-copy">{content.switchPrompt}</p>
            <Button onClick={() => navigate(alternatePath)} tone="secondary">
              {content.switchAction}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};
