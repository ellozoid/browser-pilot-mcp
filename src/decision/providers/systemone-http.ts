import { DecisionProviderError, httpDecisionError } from "../errors.ts";
import { normalizeDecisionResponse } from "../validate.ts";
import type { DecisionProvider, DecisionProviderCapabilities, DecisionQuestions, DecisionRequest, DecisionResponse } from "../types.ts";
import type { JsonValue } from "../../types.ts";

export interface SystemOneHttpOptions {
  id?: string;
  model: string;
  endpoint: string;
  apiKey?: string;
  headers?: Record<string, string>;
  capabilities?: Partial<DecisionProviderCapabilities>;
  fetch?: typeof globalThis.fetch;
  requestModel?: string;
}

const SYSTEM_ONE_CAPABILITIES: DecisionProviderCapabilities = {
  choice: true,
  noul: true,
  score: true,
  images: false,
};

export class SystemOneHttpProvider implements DecisionProvider {
  readonly id: string;
  readonly model: string;
  readonly endpoint: string;
  readonly capabilities: DecisionProviderCapabilities;
  private readonly apiKey?: string;
  private readonly headers: Record<string, string>;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly requestModel: string;

  constructor(options: SystemOneHttpOptions) {
    this.id = options.id ?? "systemone";
    this.model = options.model;
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.requestModel = options.requestModel ?? options.model;
    this.capabilities = { ...SYSTEM_ONE_CAPABILITIES, ...options.capabilities };
  }

  async decide<Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResponse<Q>> {
    let response: Response;
    const headers = new Headers(this.headers);

    headers.set("content-type", "application/json");

    if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);

    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.requestModel, ...request }),
      });
    } catch (error) {
      throw new DecisionProviderError(
        "unavailable",
        this.id,
        this.model,
        `Decision provider "${this.id}" is unavailable for model "${this.model}".`,
        undefined,
        error,
      );
    }

    if (!response.ok) throw httpDecisionError(this.id, this.model, response.status);
    let body: JsonValue;

    try {
      body = await response.json() as JsonValue;
    } catch (error) {
      throw new DecisionProviderError("invalid_response", this.id, this.model, `Decision provider "${this.id}" returned non-JSON for model "${this.model}".`, response.status, error);
    }

    return normalizeDecisionResponse(this.id, this.model, body, request);
  }
}

export function systemOneEndpoint(baseUrl: string, endpoint?: string): string {
  if (endpoint) return endpoint;

  return `${baseUrl.replace(/\/+$/, "")}/v1/systemone`;
}
