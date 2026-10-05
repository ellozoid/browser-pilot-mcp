import { DecisionProviderError } from "./decision/errors.ts";

export type RunErrorKind =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "provider_unavailable"
  | "invalid_decision_response"
  | "browser_error"
  | "blocked"
  | "verification_failed"
  | "timeout";

export function classifyRunError(error: Error | string): RunErrorKind {
  if (error instanceof DecisionProviderError) {
    if (error.kind === "unavailable") return "provider_unavailable";

    if (error.kind === "invalid_response") return "invalid_decision_response";

    return error.kind;
  }

  const message = error instanceof Error ? error.message : error;

  if (/timed? ?out|timeout/i.test(message)) return "timeout";

  if (/completion.*(?:failed|unverified)|verification failed/i.test(message)) return "verification_failed";

  if (/API_KEY|not configured| is required|PROVIDER is not set/i.test(message)) return "configuration";

  return "browser_error";
}
