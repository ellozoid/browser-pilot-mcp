import { APIError, TypeSafeClient } from "@typesafe-ai/sdk";
import { DecisionProviderError } from "../errors.ts";
import { normalizeDecisionResponse } from "../validate.ts";
import type { DecisionProvider, DecisionQuestions, DecisionRequest, DecisionResponse } from "../types.ts";
import type { JsonValue } from "../../types.ts";

export interface TypeSafeProviderOptions {
  id: "typesafe" | "openrouter";
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

export class TypeSafeDecisionProvider implements DecisionProvider {
  readonly capabilities = { choice: true, noul: true, score: true, images: false };
  readonly endpoint: string;
  readonly id: "typesafe" | "openrouter";
  readonly model: string;
  private readonly client: TypeSafeClient;

  constructor(options: TypeSafeProviderOptions) {
    this.id = options.id;
    this.model = options.model;
    this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/v1/systemone`;
    this.client = new TypeSafeClient({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      defaultModel: options.model,
      fetch: options.fetch,
    });
  }

  async decide<Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResponse<Q>> {
    try {
      const response = await this.client.systemOne(request as never);
      const normalized: JsonValue = JSON.parse(JSON.stringify(response));

      return normalizeDecisionResponse(this.id, this.model, normalized, request);
    } catch (error) {
      if (error instanceof DecisionProviderError) throw error;
      const status = error instanceof APIError ? error.status : undefined;
      const kind = status === 401 || status === 403 ? "authentication" : status === 429 ? "rate_limit" : "unavailable";
      throw new DecisionProviderError(kind, this.id, this.model, `Decision provider "${this.id}"${status ? ` returned HTTP ${status}` : " failed"} for model "${this.model}".`, status, error);
    }
  }
}
