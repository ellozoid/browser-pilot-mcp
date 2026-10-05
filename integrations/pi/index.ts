
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { runAgent } from "../../bundled/cli.mjs";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "browser_run",
    label: "Browser Pilot",
    description:
      "Drive a real browser autonomously toward one goal. A configured decision model picks each operation " +
      "and target from structured page state. Returns " +
      "final status, URL, and the action history. Prefer this over step-by-step agent_browser " +
      "use for bounded web goals — search, filter, navigate, fill a form.",
    promptSnippet: "Drive a browser autonomously toward a bounded, verifiable goal",
    promptGuidelines: [
      "Use browser_run for self-contained web tasks with a clear done condition; keep step-by-step tools for exploratory work.",
      "Give browser_run a starting URL and deterministic completion evidence when possible.",
    ],
    parameters: Type.Object({
      goal: Type.String({ description: "One natural-language goal with an explicit stop condition." }),
      url: Type.String({ description: "Starting http(s) URL on the target site." }),
      engine: Type.Optional(
        StringEnum(["cdp", "agent-browser"] as const, {
          description: "Browser backend. cdp launches/attaches Chrome directly (default).",
        }),
      ),
      max_steps: Type.Optional(Type.Number({ description: "Action budget, default 60." })),
      inputs: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Known values keyed by field label or name." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await runAgent(
        {
          url: params.url,
          goals: [params.goal],
          engine: params.engine ?? "cdp",
          headed: false,
          maxSteps: params.max_steps,
          inputs: params.inputs,
        },
        {
          signal,
          onEvent: (event) =>
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: `${event.elapsed_ms ?? "?"}ms ${event.operation ?? event.type} ${event.action ?? ""} — ${event.url ?? ""}`.trim(),
                },
              ],
              details: {},
            }),
        },
      );

      if (result.status === "error") {
        throw new Error(result.error ?? "browser-pilot run failed");
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
