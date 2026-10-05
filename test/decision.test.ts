import assert from "node:assert/strict";
import test from "node:test";

import { DecisionProviderError } from "../src/decision/errors.ts";
import { CloudflareDecisionProvider } from "../src/decision/providers/cloudflare.ts";
import { SystemOneHttpProvider } from "../src/decision/providers/systemone-http.ts";
import { TypeSafeDecisionProvider } from "../src/decision/providers/typesafe.ts";
import type { DecisionRequest } from "../src/decision/types.ts";
import { validateChoice } from "../src/decision/validate.ts";

const request = {
  state: { page: "settings" },
  questions: {
    next: {
      type: "choice",
      criteria: { OPEN: "Open settings", WAIT: "Wait" },
      instructions: "Choose the next action",
    },
  },
} satisfies DecisionRequest;

const validResult = {
  model: "test-model",
  answers: {
    next: {
      type: "choice",
      choice: "OPEN",
      confidence: 0.8,
      probabilities: { OPEN: 0.8, WAIT: 0.2 },
    },
  },
  usage: { input_tokens: 10, output_tokens: 2 },
};

test("choice validation accepts a normalized maximum", () => {
  assert.doesNotThrow(() => validateChoice(validResult.answers.next, new Set(["OPEN", "WAIT"])));
});

for (const [name, answer] of [
  ["unknown choice", { ...validResult.answers.next, choice: "OTHER" }],
  ["missing probability", { ...validResult.answers.next, probabilities: { OPEN: 1 } }],
  ["NaN", { ...validResult.answers.next, probabilities: { OPEN: Number.NaN, WAIT: 0.2 } }],
  ["probability above one", { ...validResult.answers.next, probabilities: { OPEN: 1.1, WAIT: -0.1 } }],
  ["bad sum", { ...validResult.answers.next, probabilities: { OPEN: 0.4, WAIT: 0.2 } }],
  ["non-maximum choice", { ...validResult.answers.next, probabilities: { OPEN: 0.2, WAIT: 0.8 } }],
] as const) {
  test(`choice validation rejects ${name}`, () => {
    assert.throws(() => validateChoice(answer, new Set(["OPEN", "WAIT"])), /Invalid decision response/);
  });
}

test("generic System One posts canonical payload without credentials", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;

  const provider = new SystemOneHttpProvider({
    model: "local-model",
    endpoint: "http://127.0.0.1:11434/v1/systemone",
    fetch: async (url, init) => {
      seenUrl = String(url);
      seenInit = init;

      return Response.json({ ...validResult, model: "local-model" });
    },
  });

  const result = await provider.decide(request);
  const headers = new Headers(seenInit?.headers);
  const body = JSON.parse(String(seenInit?.body));

  assert.equal(seenUrl, "http://127.0.0.1:11434/v1/systemone");
  assert.equal(headers.get("authorization"), null);
  assert.equal(body.model, "local-model");
  assert.deepEqual(body.state, request.state);
  assert.deepEqual(body.questions, request.questions);
  assert.equal(result.answers.next.choice, "OPEN");
});

test("Cloudflare uses model URL, bearer auth, and result envelope", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;

  const provider = new CloudflareDecisionProvider({
    accountId: "account-1",
    apiToken: "secret-token",
    model: "@cf/cloudflare/clef-flash",
    fetch: async (url, init) => {
      seenUrl = String(url);
      seenInit = init;

      return Response.json({ success: true, result: validResult });
    },
  });

  const result = await provider.decide(request);
  const headers = new Headers(seenInit?.headers);
  const body = JSON.parse(String(seenInit?.body));

  assert.equal(seenUrl, "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run/@cf/cloudflare/clef-flash");
  assert.equal(headers.get("authorization"), "Bearer secret-token");
  assert.equal(body.model, "clef-flash");
  assert.equal(result.usage?.input_tokens, 10);
});

for (const [status, kind] of [[401, "authentication"], [403, "authentication"], [429, "rate_limit"], [500, "unavailable"]] as const) {
  test(`Cloudflare classifies HTTP ${status}`, async () => {
    const provider = new CloudflareDecisionProvider({
      accountId: "account-1",
      apiToken: "secret-token",
      model: "@cf/cloudflare/clef",
      fetch: async () => new Response("failure", { status }),
    });

    let failure: DecisionProviderError | undefined;

    try {
      await provider.decide(request);
    } catch (error) {
      if (error instanceof DecisionProviderError) failure = error;
    }

    assert.ok(failure);
    assert.equal(failure.kind, kind);
    assert.equal(failure.status, status);
    assert.doesNotMatch(failure.message, /secret-token/);
  });
}

test("Cloudflare rejects malformed success responses", async () => {
  const provider = new CloudflareDecisionProvider({
    accountId: "account-1",
    apiToken: "secret-token",
    model: "@cf/cloudflare/clef",
    fetch: async () => Response.json({ success: true, result: { answers: {} } }),
  });

  let failure: DecisionProviderError | undefined;

  try {
    await provider.decide(request);
  } catch (error) {
    if (error instanceof DecisionProviderError) failure = error;
  }

  assert.equal(failure?.kind, "invalid_response");
});

test("TypeSafe adapter owns SDK request translation", async () => {
  let seenUrl = "";
  let seenBody: unknown;

  const provider = new TypeSafeDecisionProvider({
    id: "typesafe",
    apiKey: "typesafe-key",
    baseUrl: "https://decision.example",
    model: "jev-custom",
    fetch: async (url, init) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init?.body));

      return Response.json({ ...validResult, model: "jev-custom" });
    },
  });

  const result = await provider.decide(request);

  assert.equal(seenUrl, "https://decision.example/v1/systemone");
  assert.deepEqual(seenBody, { ...request, model: "jev-custom" });
  assert.equal(result.model, "jev-custom");
});
