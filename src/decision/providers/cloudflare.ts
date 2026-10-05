import { SystemOneHttpProvider } from "./systemone-http.ts";

export interface CloudflareProviderOptions {
  accountId: string;
  apiToken: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class CloudflareDecisionProvider extends SystemOneHttpProvider {
  constructor(options: CloudflareProviderOptions) {
    const base = (options.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");
    const endpoint = `${base}/accounts/${encodeURIComponent(options.accountId)}/ai/run/${options.model}`;

    super({
      id: "cloudflare",
      model: options.model,
      endpoint,
      apiKey: options.apiToken,
      capabilities: { images: true },
      fetch: options.fetch,
      requestModel: options.model.split("/").at(-1) ?? options.model,
    });
  }
}
