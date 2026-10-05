import assert from "node:assert/strict";
import test from "node:test";

import { deterministicFieldValue } from "../src/text/inputs.ts";
import type { ObservedAction, PageState } from "../src/types.ts";

function page(actions: ObservedAction[]): PageState {
  return {
    url: "https://example.test/login",
    title: "Login",
    w: 1000,
    h: 800,
    text: "",
    scroll: { y: 0, height: 800 },
    actions,
    marker: null,
    page_key: null,
    guards: {},
    omitted_actions: 0,
    fingerprint: "fixture",
  };
}

test("deterministic input resolves a unique exact field", () => {
  const email: ObservedAction = { id: "fill-email", kind: "fill", label: "Email", node: 1, role: "textbox" };
  const password: ObservedAction = { id: "fill-password", kind: "fill", label: "Password", node: 2, role: "textbox" };
  const result = deterministicFieldValue(email, page([email, password]), { email: "test@example.com", password: "secret" });

  assert.deepEqual(result, { key: "email", value: "test@example.com" });
});

test("deterministic input falls back when one key matches multiple fields", () => {
  const primary: ObservedAction = { id: "fill-email", kind: "fill", label: "Email address", node: 1 };
  const confirmation: ObservedAction = { id: "fill-email-confirm", kind: "fill", label: "Email address", node: 2 };

  assert.equal(deterministicFieldValue(primary, page([primary, confirmation]), { email: "test@example.com" }), null);
});

test("deterministic input does not guess a weak substring", () => {
  const field: ObservedAction = { id: "fill-contact", kind: "fill", label: "Contact information", node: 1 };

  assert.equal(deterministicFieldValue(field, page([field]), { email: "test@example.com" }), null);
});
