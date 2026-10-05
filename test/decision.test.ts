import assert from "node:assert/strict";
import test from "node:test";

import { DecisionProviderError } from "../src/decision/errors.ts";
import { CloudflareDecisionProvider } from "../src/decision/providers/cloudflare.ts";
import { SystemOneHttpProvider } from "../src/decision/providers/systemone-http.ts";
import { TypeSafeDecisionProvider } from "../src/decision/providers/typesafe.ts";
import type { DecisionProvider, DecisionRequest, DecisionResponse } from "../src/decision/types.ts";
import { validateChoice } from "../src/decision/validate.ts";
import { choose } from "../src/model/decide.ts";
import type { PageState } from "../src/types.ts";

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

const singletonState: PageState = {
  url: "https://example.test",
  title: "Singleton targets",
  w: 1280,
  h: 720,
  text: "Source Destination",
  scroll: { y: 0, height: 720 },
  actions: [
    { id: "source", kind: "click", label: "Source", node: 1, draggable: true, contextMenu: true },
    { id: "destination", kind: "click", label: "Destination", node: 2, dropZone: true },
  ],
  marker: null,
  page_key: null,
  guards: {},
  omitted_actions: 0,
  fingerprint: "singleton",
};

function choosingProvider(operation: string, inspect: (request: DecisionRequest) => void): DecisionProvider {
  return {
    id: "test",
    model: "test-model",
    capabilities: { choice: true, noul: true, score: true },
    async decide<Q extends DecisionRequest["questions"]>(request: DecisionRequest<Q>): Promise<DecisionResponse<Q>> {
      inspect(request);

      const answers = Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
        const keys = Object.keys(question.type === "choice" ? question.criteria : {});
        const choice = name === "operation" ? operation : name === "drag_target" ? keys.at(-1)! : keys[0];

        return [name, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0])) }];
      }));

      return { model: "test-model", answers } as DecisionResponse<Q>;
    },
  };
}

test("singleton target questions are resolved without asking the provider", async () => {
  const provider = choosingProvider("CONTEXT_CLICK", request => {
    assert.equal(request.questions.context_click_target, undefined);
    assert.equal(request.questions.drag_source, undefined);
    assert.equal(Object.keys(request.questions.drag_target?.criteria ?? {}).length, 2);
    assert.ok(Object.values(request.questions).every(question => question.type !== "choice" || Object.keys(question.criteria).length >= 2));
  });

  const decision = await choose(provider, singletonState, "Open the context menu", []);

  assert.equal(decision.choice, "source");
  assert.equal(decision.target, "1");
  assert.equal(decision.target_confidence, 1);
  assert.deepEqual(decision.target_probabilities, { "1": 1 });
});

test("singleton drag sources are resolved while destinations remain model-selected", async () => {
  const provider = choosingProvider("DRAG", request => {
    assert.equal(request.questions.drag_source, undefined);
    assert.equal(Object.keys(request.questions.drag_target?.criteria ?? {}).length, 2);
  });

  const decision = await choose(provider, singletonState, "Drag Source onto Destination", []);

  assert.equal(decision.choice, "source");
  assert.equal(decision.target, "1");
  assert.equal(decision.target2, "destination");
});
