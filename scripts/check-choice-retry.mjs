import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { TypeSafeDecisionProvider } from "../src/decision/providers/typesafe.ts";
import { choiceRequest } from "../src/model/choice-request.ts";

let calls = 0;

let alwaysInvalid = false;

const server = createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  calls++;
  const invalid = alwaysInvalid || calls === 1;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ model: "fixture", answers: { result: { type: "choice", choice: "YES", probabilities: { YES: invalid ? 0.4 : 1, NO: invalid ? 0.6 : 0 }, confidence: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1, cost: 0 } }));
});

server.listen(0, "127.0.0.1");

await once(server, "listening");

const address = server.address();

assert(address && Object.hasOwn(address, "port"));

const provider = new TypeSafeDecisionProvider({ id: "typesafe", apiKey: "fixture-only", baseUrl: `http://127.0.0.1:${address.port}`, model: "fixture" });

const request = { state: "fixture", questions: { result: { type: "choice", criteria: { YES: "yes", NO: "no" } } } };

try {
  const result = await choiceRequest(provider, request, "check");
  assert.equal(calls, 2);
  assert.equal(result.answers.result.choice, "YES");
  assert.equal(result.answers.result.probabilities.YES, 1);
  alwaysInvalid = true;
  calls = 0;
  await assert.rejects(() => choiceRequest(provider, request, "check"), /invalid response/);
  assert.equal(calls, 2);
  console.log("choice-retry: corrected response accepted; persistent inconsistency rejected after two calls");
} finally {
  server.close();
}
