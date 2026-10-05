import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { DecisionProviderError } from "./decision/errors.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function loadDotEnv(): void {
  for (const dir of [
    PACKAGE_ROOT,
    process.env.PLUGIN_DATA,
    process.env.CLAUDE_PLUGIN_DATA,
    process.cwd(),
  ]) {
    if (!dir) continue;
    let text: string;

    try {
      text = readFileSync(join(dir, ".env"), "utf8");
    } catch {
      continue;
    }

    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();

      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");

      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

export interface BrowserPilotConfig {
  decision: {
    provider: string;
    model: string;
    baseUrl?: string;
    endpoint?: string;
    apiKey?: string;
    cloudflareAccountId?: string;
  };
  text: {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  browser: {
    cdpUrl?: string;
    allowFileUrls: boolean;
    headed: boolean;
  };
}

let warnedLegacy = false;

function warnLegacy(names: string[]): void {
  if (warnedLegacy || names.length === 0) return;
  warnedLegacy = true;
  process.stderr.write(`Browser Pilot: legacy configuration ${names.join(", ")} is deprecated; use BROWSER_PILOT_DECISION_* variables.\n`);
}

function inferLegacyProvider(): string {
  const named = process.env.JEV_PROVIDER?.trim();

  if (named) return named;
  const hasTypeSafe = Boolean(process.env.TYPESAFE_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  if (hasTypeSafe && hasOpenRouter) {
    throw new DecisionProviderError("configuration", "configuration", "", "Both TYPESAFE_API_KEY and OPENROUTER_API_KEY are set. Set BROWSER_PILOT_DECISION_PROVIDER explicitly.");
  }

  if (hasOpenRouter) return "openrouter";

  if (hasTypeSafe) return "typesafe";

  throw new DecisionProviderError("configuration", "configuration", "", "BROWSER_PILOT_DECISION_PROVIDER is not set and no unambiguous legacy provider can be inferred.");
}

export function readBrowserPilotConfig(): BrowserPilotConfig {
  loadDotEnv();
  const explicitProvider = process.env.BROWSER_PILOT_DECISION_PROVIDER?.trim();
  const provider = explicitProvider || inferLegacyProvider();
  const legacyNames = explicitProvider ? [] : ["JEV_PROVIDER", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY"].filter(name => Boolean(process.env[name]));

  warnLegacy(legacyNames);
  const legacyModel = process.env.TYPESAFE_MODEL ?? process.env.TYPESAFE_DEFAULT_MODEL;
  const defaultModel = provider === "typesafe" ? "jev-latest" : provider === "openrouter" ? "typesafe/jev-latest" : "";
  const model = process.env.BROWSER_PILOT_DECISION_MODEL?.trim() || legacyModel?.trim() || defaultModel;

  if (!model) throw new DecisionProviderError("configuration", provider, "", `BROWSER_PILOT_DECISION_MODEL is required for decision provider "${provider}".`);

  const providerKey = provider === "cloudflare"
    ? process.env.CLOUDFLARE_API_TOKEN
    : provider === "typesafe"
      ? process.env.TYPESAFE_API_KEY
      : provider === "openrouter"
        ? process.env.OPENROUTER_API_KEY
        : undefined;

  return {
    decision: {
      provider,
      model,
      baseUrl: process.env.BROWSER_PILOT_DECISION_BASE_URL ?? (["typesafe", "openrouter"].includes(provider) ? process.env.TYPESAFE_BASE_URL : undefined),
      endpoint: process.env.BROWSER_PILOT_DECISION_ENDPOINT,
      apiKey: process.env.BROWSER_PILOT_DECISION_API_KEY ?? providerKey,
      cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    },
    text: {
      model: process.env.TEXT_MODEL,
      baseUrl: process.env.TEXT_MODEL_BASE_URL,
      apiKey: process.env.TEXT_MODEL_API_KEY,
    },
    browser: {
      cdpUrl: process.env.BROWSER_PILOT_CDP_URL ?? process.env.JEV_CDP_URL,
      allowFileUrls: process.env.BROWSER_PILOT_ALLOW_FILE_URLS === "1" || process.env.JEV_ALLOW_FILE_URLS === "1",
      headed: process.env.BROWSER_PILOT_HEADED === "1",
    },
  };
}
