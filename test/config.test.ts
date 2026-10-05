import assert from "node:assert/strict";
import test from "node:test";

import { createDecisionProvider } from "../src/decision/registry.ts";
import { DecisionProviderError } from "../src/decision/errors.ts";
import { readBrowserPilotConfig } from "../src/env.ts";
import { classifyRunError } from "../src/errors.ts";

type EnvironmentPatch = Record<string, string | undefined>;

async function withEnvironment(patch: EnvironmentPatch, run: () => void | Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(patch).map(key => [key, process.env[key]]));

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const decisionEnvironment = {
  BROWSER_PILOT_DECISION_PROVIDER: undefined,
  BROWSER_PILOT_DECISION_MODEL: undefined,
  BROWSER_PILOT_DECISION_BASE_URL: undefined,
  BROWSER_PILOT_DECISION_ENDPOINT: undefined,
  BROWSER_PILOT_DECISION_API_KEY: undefined,
  JEV_PROVIDER: undefined,
  TYPESAFE_MODEL: undefined,
  TYPESAFE_DEFAULT_MODEL: undefined,
  TYPESAFE_BASE_URL: undefined,
  TYPESAFE_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
  CLOUDFLARE_ACCOUNT_ID: undefined,
  CLOUDFLARE_API_TOKEN: undefined,
} satisfies EnvironmentPatch;

test("new decision settings take precedence over legacy settings", async () => {
  await withEnvironment({
    ...decisionEnvironment,
    BROWSER_PILOT_DECISION_PROVIDER: "systemone",
    BROWSER_PILOT_DECISION_MODEL: "SuperFastDecision-3B",
    BROWSER_PILOT_DECISION_BASE_URL: "http://localhost:9000",
    JEV_PROVIDER: "typesafe",
    TYPESAFE_MODEL: "jev-legacy",
    TYPESAFE_API_KEY: "legacy-key",
  }, () => {
    const config = readBrowserPilotConfig();

    assert.equal(config.decision.provider, "systemone");
    assert.equal(config.decision.model, "SuperFastDecision-3B");
    assert.equal(config.decision.baseUrl, "http://localhost:9000");
  });
});

test("legacy TypeSafe configuration normalizes deterministically", async () => {
  await withEnvironment({ ...decisionEnvironment, TYPESAFE_API_KEY: "legacy-key" }, () => {
    const config = readBrowserPilotConfig();

    assert.equal(config.decision.provider, "typesafe");
    assert.equal(config.decision.model, "jev-latest");
    assert.equal(config.decision.apiKey, "legacy-key");
  });
});

test("conflicting legacy provider keys require an explicit choice", async () => {
  await withEnvironment({
    ...decisionEnvironment,
    TYPESAFE_API_KEY: "typesafe-key",
    OPENROUTER_API_KEY: "openrouter-key",
  }, () => {
    assert.throws(() => readBrowserPilotConfig(), DecisionProviderError);
  });
});

test("Ollama registry entry uses local System One without a key", () => {
  const provider = createDecisionProvider({ provider: "ollama", model: "clef-flash" });

  assert.equal(provider.id, "ollama");
  assert.equal(provider.model, "clef-flash");
  assert.equal(provider.endpoint, "http://127.0.0.1:11434/v1/systemone");
});

test("generic System One accepts a full endpoint without a base URL", () => {
  const provider = createDecisionProvider({
    provider: "systemone",
    model: "custom",
    endpoint: "http://localhost:9000/custom/decide",
  });

  assert.equal(provider.endpoint, "http://localhost:9000/custom/decide");
});

test("run errors expose stable categories", () => {
  assert.equal(classifyRunError(new DecisionProviderError("rate_limit", "cloudflare", "clef", "limited", 429)), "rate_limit");
  assert.equal(classifyRunError(new Error("Browser operation timed out")), "timeout");
  assert.equal(classifyRunError(new Error("TEXT_MODEL_API_KEY is not configured")), "configuration");
});
