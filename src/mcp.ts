#!/usr/bin/env node

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { parseExpectation } from "./completion.ts";
import { runOnce } from "./cli.ts";
import { loadDotEnv } from "./env.ts";
import { isBoolean, isFiniteNumber, isJsonObject, isString } from "./json.ts";
import type { JsonObject, JsonValue } from "./types.ts";

interface JsonRpcRequest {
  id?: JsonValue;
  method?: string;
  params?: {
    name?: string;
    arguments?: JsonObject;
  };
}

const PROTOCOL_VERSION = "2024-11-05";

const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "package.json"), "utf8"),
    );

    return isString(pkg.version) ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const ALLOWED_ARGS = new Set(["goal", "url", "engine", "headed", "max_steps", "expect", "stop_at_challenge", "inputs", "include_history"]);

const TOOL = {
  name: "browser_run",
  description:
    "Drive a real browser autonomously toward a bounded goal. A configured decision model selects " +
    "browser operations and targets from structured page state, while Browser Pilot executes and " +
    "verifies them. Prefer this over step-by-step browsing for a self-contained web task " +
    "(search, filter, navigate, fill a form). When a persistent CDP browser is configured, omit " +
    "engine so Browser Pilot reuses its existing window, writable profile, cookies, and signed-in " +
    "session. Select agent-browser only when the user explicitly requests that backend. The agent " +
    "stops itself when done or blocked. There is " +
    "no purchase/credential guardrail — scope goals accordingly and verify the outcome independently; " +
    "the agent's DONE claim is not proof.",
  inputSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description:
          "One natural-language goal, e.g. 'Find one-way flights Zurich to London on Sep 20 2026 and stop when results are visible.'",
      },
      url: {
        type: "string",
        description:
          "Starting page URL (http/https). Pick the site the goal is about — the agent navigates in-page, it cannot type in the address bar.",
      },
      engine: {
        type: "string",
        enum: ["cdp", "agent-browser"],
        description:
          "Browser backend. Omit this to use cdp, including any configured persistent CDP browser. Select agent-browser only when the user explicitly requests it.",
      },
      headed: {
        type: "boolean",
        description:
          "Show a browser launched for this task. A configured persistent CDP browser keeps its existing visible window. Overrides BROWSER_PILOT_HEADED for this call.",
      },
      expect: {
        type: "object",
        description: "Required completion evidence. Every supplied regex must match the terminal observation.",
        properties: Object.fromEntries(["url_match", "text_match", "state_match", "frames_match"].map(key => [key, { type: "string", minLength: 1 }])),
        additionalProperties: false,
        minProperties: 1,
      },
      stop_at_challenge: {
        type: "boolean",
        description: "Stop as blocked when visible verification is detected, without interacting with it.",
      },
      inputs: {
        type: "object",
        description: "Caller-supplied field values. Unambiguous label/name matches bypass the text model.",
        additionalProperties: { type: "string" },
      },
      include_history: {
        type: "boolean",
        description: "Include full action history and final page evidence instead of the compact default result.",
      },
      max_steps: {
        type: "number",
        description: "Action budget, default 60.",
      },
    },
    required: ["goal", "url"],
    additionalProperties: false,
  },
};

function respond(id: JsonValue, result: JsonValue): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id: JsonValue, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

function toolResult(id: JsonValue, text: string, isError = false): void {
  respond(id, { content: [{ type: "text", text }], isError });
}

let queue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
}

function decodeInputs(value: JsonValue): Record<string, string> | undefined {
  if (value === undefined) return undefined;

  if (!isJsonObject(value)) throw new Error("inputs must be an object of string values");

  const entries = Object.entries(value);

  if (!entries.every(([key, input]) => Boolean(key.trim()) && isString(input))) throw new Error("inputs must be an object of string values");

  return Object.fromEntries(entries) as Record<string, string>;
}

async function callBrowserRun(id: JsonValue, args: JsonObject): Promise<void> {
  const unknown = Object.keys(args).filter((k) => !ALLOWED_ARGS.has(k));

  if (unknown.length) {
    respondError(id, -32602, `browser_run: unknown arguments: ${unknown.join(", ")}`);

    return;
  }

  if (!isString(args.goal) || !isString(args.url)) {
    respondError(id, -32602, "browser_run requires { goal: string, url: string }");

    return;
  }

  if (args.headed !== undefined && !isBoolean(args.headed)) {
    respondError(id, -32602, "browser_run headed must be a boolean");

    return;
  }

  try {
    const result = await runOnce(
      {
        url: args.url,
        goals: [args.goal],
        engine: args.engine === "agent-browser" ? "agent-browser" : "cdp",
        headed: isBoolean(args.headed) ? args.headed : process.env.BROWSER_PILOT_HEADED === "1",
        cdpUrl: process.env.BROWSER_PILOT_CDP_URL ?? process.env.JEV_CDP_URL,
        maxSteps: isFiniteNumber(args.max_steps) ? args.max_steps : undefined,
        expectation: args.expect === undefined ? undefined : parseExpectation(args.expect),
        stopAtChallenge: args.stop_at_challenge === true ? true : undefined,
        inputs: decodeInputs(args.inputs),
      },
      (event) =>
        process.stderr.write(JSON.stringify({ call: id, ...event }) + "\n"),
    );

    const output = args.include_history === true ? result : {
      status: result.status,
      final_url: result.final_url,
      steps: result.steps,
      decisions: result.decisions,
      elapsed_ms: result.elapsed_ms,
      blocked_cause: result.blocked_cause ?? null,
      answer: result.answer ?? null,
      error: result.error ?? null,
      error_kind: result.error_kind ?? null,
    };

    toolResult(id, JSON.stringify(output), result.status === "error");
  } catch (error) {
    toolResult(
      id,
      `browser_run failed before completing: ${error instanceof Error ? error.message : error}`,
      true,
    );
  }
}

async function handle(request: JsonRpcRequest): Promise<void> {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "browser-pilot", version: PKG_VERSION },
      });

      return;
    case "notifications/initialized":
    case "initialized":
      return;
    case "ping":
      respond(id, {});

      return;
    case "tools/list":
      respond(id, { tools: [TOOL] });

      return;
    case "tools/call": {
      if (params?.name !== "browser_run" && params?.name !== "jev_browse") {
        respondError(id, -32602, `Unknown tool: ${params?.name}`);

        return;
      }

      await enqueue(() => callBrowserRun(id, params?.arguments ?? {}));

      return;
    }

    default:
      if (id !== undefined) respondError(id, -32601, `Method not found: ${method}`);
  }
}

loadDotEnv();

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  let request: JsonRpcRequest;

  try {
    request = JSON.parse(line);
  } catch {
    respondError(null, -32700, "Parse error");

    return;
  }

  handle(request).catch((error) =>
    respondError(request.id ?? null, -32603, error instanceof Error ? error.message : String(error)),
  );
});
