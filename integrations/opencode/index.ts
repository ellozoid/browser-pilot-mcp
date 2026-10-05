import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

interface BrowseExpectation {
  url_match?: string;
  text_match?: string;
  state_match?: string;
  frames_match?: string;
}

interface BrowseRequest {
  goal: string;
  url: string;
  engine: "cdp" | "agent-browser";
  headed?: boolean;
  maxSteps?: number;
  expectation?: BrowseExpectation;
  stopAtChallenge?: boolean;
  inputs?: Record<string, string>;
}

interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface ExecuteContext {
  signal: AbortSignal;
}

interface HostTool {
  name: string;
  description: string;
  input: JsonValue;
  execute: (input: JsonValue, context: ExecuteContext) => Promise<JsonValue>;
}

interface HostToolEditor {
  add(tool: HostTool): void;
}

interface HostToolRegistration {
  dispose(): Promise<void>;
}

interface HostToolRegistry {
  transform(callback: (editor: HostToolEditor) => void): Promise<HostToolRegistration>;
}

interface Host {
  tool: HostToolRegistry;
}

interface HostPlugin {
  id: string;
  setup(ctx: Host): Promise<void>;
}

const EXPECTATION_KEYS = ["url_match", "text_match", "state_match", "frames_match"] as const;

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && value !== undefined && !Array.isArray(value) && value === Object(value);
}

function isString(value: JsonValue): value is string {
  return typeof value === "string";
}

function isBoolean(value: JsonValue): value is boolean {
  return value === true || value === false;
}

function isFiniteNumber(value: JsonValue): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function decodeExpectation(value: JsonValue): BrowseExpectation {
  if (!isObject(value) || Object.keys(value).length === 0) {
    throw new Error("expect requires a nonempty object of completion patterns");
  }

  const unexpected = Object.keys(value).filter((key) => !EXPECTATION_KEYS.some((allowed) => key === allowed));

  if (unexpected.length > 0) {
    throw new Error(`Completion patterns support only ${EXPECTATION_KEYS.join(", ")}`);
  }

  const expectation: BrowseExpectation = {};

  for (const key of EXPECTATION_KEYS) {
    const pattern = value[key];

    if (pattern === undefined) continue;

    if (!isString(pattern) || pattern.length === 0) throw new Error(`${key} must be a nonempty regex string`);
    new RegExp(pattern);
    expectation[key] = pattern;
  }

  return expectation;
}

function cliPath(): string {
  return fileURLToPath(new URL("../../bundled/cli.mjs", import.meta.url));
}

function runCli(args: string[], signal: AbortSignal): Promise<RunOutcome> {
  return new Promise<RunOutcome>((resolve, reject) => {
    const child = spawn("node", [cliPath(), ...args], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";

    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const onAbort = () => {
      child.kill();
    };

    child.on("error", (cause: Error) => {
      reject(new Error(`browser_run could not start node: ${cause.message}`));
    });

    child.on("close", (code: number | null) => {
      signal.removeEventListener("abort", onAbort);

      resolve({ code, stdout, stderr });
    });

    signal.addEventListener("abort", onAbort, { once: true });

    if (signal.aborted) onAbort();
  });
}

function failureMessage(outcome: RunOutcome): string {
  const tail = outcome.stderr.trim().split("\n").slice(-3).join("\n");

  if (outcome.code === null) return `browser_run was stopped${tail ? `: ${tail}` : ""}`;

  const detail = outcome.stdout.trim() || tail;

  return `browser_run exited with code ${outcome.code}${detail ? `: ${detail}` : ""}`;
}

function decodeRequest(value: JsonValue): BrowseRequest {
  if (!isObject(value)) throw new Error("browser_run requires { goal: string, url: string }");

  const { goal, url, engine, headed, max_steps, expect, stop_at_challenge, inputs } = value;

  if (!isString(goal) || !isString(url)) throw new Error("browser_run requires { goal: string, url: string }");

  const request: BrowseRequest = {
    goal,
    url,
    engine: engine === "agent-browser" ? "agent-browser" : "cdp",
  };

  if (isFiniteNumber(max_steps)) request.maxSteps = max_steps;

  if (isBoolean(headed)) request.headed = headed;

  if (expect !== undefined) request.expectation = decodeExpectation(expect);

  if (stop_at_challenge === true) request.stopAtChallenge = true;

  if (inputs !== undefined) {
    if (!isObject(inputs) || !Object.values(inputs).every(isString)) throw new Error("inputs must be an object of string values");
    request.inputs = inputs as Record<string, string>;
  }

  return request;
}

const plugin: HostPlugin = {
  id: "browser-pilot-mcp",
  async setup(ctx: Host) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "browser_run",
        description:
          "Drive a real browser autonomously toward a goal. A configured decision model picks each operation and target " +
          "from structured page state. Returns the final status, URL, " +
          "and action history. Prefer this over step-by-step browsing when a task is a bounded web goal " +
          "(search, filter, navigate, fill a form). The agent stops itself when done or blocked. There is " +
          "no purchase/credential guardrail — scope goals accordingly and verify the outcome independently; " +
          "the agent's DONE claim is not proof.",
        input: {
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
                "Browser backend. cdp launches/attaches Chrome directly; agent-browser uses the agent-browser CLI session.",
            },
            headed: {
              type: "boolean",
              description: "Show the browser window while the task runs.",
            },
            expect: {
              type: "object",
              description: "Required completion evidence. Every supplied regex must match the terminal observation.",
              properties: {
                url_match: { type: "string", minLength: 1 },
                text_match: { type: "string", minLength: 1 },
                state_match: { type: "string", minLength: 1 },
                frames_match: { type: "string", minLength: 1 },
              },
              additionalProperties: false,
              minProperties: 1,
            },
            stop_at_challenge: {
              type: "boolean",
              description: "Stop as blocked when visible verification is detected, without interacting with it.",
            },
            max_steps: {
              type: "number",
              description: "Action budget, default 60.",
            },
            inputs: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Known values keyed by field label or name.",
            },
          },
          required: ["goal", "url"],
          additionalProperties: false,
        },
        execute: async (input: JsonValue, context: ExecuteContext) => {
          const request = decodeRequest(input);

          const args = ["--url", request.url, "--goal", request.goal, "--engine", request.engine];

          if (request.headed === true) args.push("--headed");

          if (request.headed === false) args.push("--headless");

          if (request.maxSteps !== undefined) args.push("--max-steps", String(request.maxSteps));

          if (request.expectation !== undefined) args.push("--expect", JSON.stringify(request.expectation));

          if (request.stopAtChallenge === true) args.push("--stop-at-challenge");

          if (request.inputs !== undefined) args.push("--inputs", JSON.stringify(request.inputs));

          const outcome = await runCli(args, context.signal);

          if (outcome.code === 0 || outcome.code === 2) {
            if (!outcome.stdout.trim()) throw new Error(failureMessage(outcome));

            return { content: outcome.stdout };
          }

          throw new Error(failureMessage(outcome));
        },
      });
    });
  },
};

export default plugin;
