import { DecisionProviderError } from "./errors.ts";
import { CloudflareDecisionProvider } from "./providers/cloudflare.ts";
import { SystemOneHttpProvider, systemOneEndpoint } from "./providers/systemone-http.ts";
import { TypeSafeDecisionProvider } from "./providers/typesafe.ts";
import type { DecisionProvider } from "./types.ts";
import type { BrowserPilotConfig } from "../env.ts";

type ProviderFactory = (config: BrowserPilotConfig["decision"]) => DecisionProvider;

function required(value: string | undefined, name: string, provider: string, model: string): string {
  if (value) return value;
  throw new DecisionProviderError("configuration", provider, model, `${name} is required for decision provider "${provider}".`);
}

const factories = {
  typesafe: config => new TypeSafeDecisionProvider({
    id: "typesafe",
    model: config.model,
    apiKey: required(config.apiKey, "TYPESAFE_API_KEY or BROWSER_PILOT_DECISION_API_KEY", "typesafe", config.model),
    baseUrl: config.baseUrl ?? "https://api.typesafe.ai",
  }),
  openrouter: config => new TypeSafeDecisionProvider({
    id: "openrouter",
    model: config.model,
    apiKey: required(config.apiKey, "OPENROUTER_API_KEY or BROWSER_PILOT_DECISION_API_KEY", "openrouter", config.model),
    baseUrl: config.baseUrl ?? "https://openrouter.ai/api",
  }),
  cloudflare: config => new CloudflareDecisionProvider({
    model: config.model,
    accountId: required(config.cloudflareAccountId, "CLOUDFLARE_ACCOUNT_ID", "cloudflare", config.model),
    apiToken: required(config.apiKey, "CLOUDFLARE_API_TOKEN or BROWSER_PILOT_DECISION_API_KEY", "cloudflare", config.model),
    baseUrl: config.baseUrl,
  }),
  systemone: config => new SystemOneHttpProvider({
    id: "systemone",
    model: config.model,
    endpoint: systemOneEndpoint(config.baseUrl ?? "", config.endpoint),
    apiKey: config.apiKey,
  }),
  ollama: config => new SystemOneHttpProvider({
    id: "ollama",
    model: config.model,
    endpoint: systemOneEndpoint(config.baseUrl ?? "http://127.0.0.1:11434", config.endpoint),
    apiKey: config.apiKey,
  }),
} satisfies Record<string, ProviderFactory>;

export function createDecisionProvider(config: BrowserPilotConfig["decision"]): DecisionProvider {
  if (config.provider === "systemone" && !config.baseUrl && !config.endpoint) {
    required(undefined, "BROWSER_PILOT_DECISION_BASE_URL or BROWSER_PILOT_DECISION_ENDPOINT", config.provider, config.model);
  }

  const factory = config.provider in factories ? factories[config.provider as keyof typeof factories] : undefined;

  if (!factory) {
    throw new DecisionProviderError("configuration", config.provider, config.model, `Unknown decision provider "${config.provider}". Available providers: ${Object.keys(factories).join(", ")}.`);
  }

  const provider = factory(config);

  if (!provider.capabilities.choice) {
    throw new DecisionProviderError("configuration", provider.id, provider.model, `Decision provider "${provider.id}" does not support required choice questions.`);
  }

  return provider;
}
