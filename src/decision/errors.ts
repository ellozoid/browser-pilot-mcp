export type DecisionErrorKind =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "unavailable"
  | "invalid_response";

export class DecisionProviderError extends Error {
  readonly kind: DecisionErrorKind;
  readonly provider: string;
  readonly model: string;
  readonly status?: number;

  constructor(kind: DecisionErrorKind, provider: string, model: string, message: string, status?: number, cause?: unknown) {
    super(message, { cause });
    this.name = "DecisionProviderError";
    this.kind = kind;
    this.provider = provider;
    this.model = model;
    this.status = status;
  }
}

export function httpDecisionError(provider: string, model: string, status: number): DecisionProviderError {
  const kind = status === 401 || status === 403
    ? "authentication"
    : status === 429
      ? "rate_limit"
      : "unavailable";

  return new DecisionProviderError(
    kind,
    provider,
    model,
    `Decision provider "${provider}" returned HTTP ${status} for model "${model}".`,
    status,
  );
}
