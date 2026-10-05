# Browser Pilot MCP

Browser Pilot MCP is an autonomous browser agent for MCP clients and the command line. Give it a start URL, a bounded goal, and optional deterministic completion evidence; it observes a real browser, asks a configurable decision model what to do next, executes the selected operation, and verifies the result in code.

## What it does

- Drives Chrome through CDP or an existing `agent-browser` session.
- Builds an indexed action space from live DOM, iframe, shadow DOM, tab, keyboard, upload, and page-state observations.
- Uses a provider-neutral System One decision interface for operation and target selection.
- Keeps free-form field text generation separate from decision making.
- Verifies `url_match`, `text_match`, `state_match`, and `frames_match` instead of trusting a model's `DONE` claim.
- Exposes one high-level MCP tool, `browser_run`, plus `browser-pilot` and `browser-pilot-mcp` binaries.

## Why

Calling a click tool for every browser step makes the host LLM plan, observe, and spend context on the entire interaction. Browser Pilot accepts the complete browser task, runs its own bounded loop, and returns a compact result. The decision model is an adapter, not the architecture: Cloudflare Clef, TypeSafe Jev, OpenRouter, Ollama, and other System One-compatible endpoints can select actions without changes to the browser loop.

## Architecture

```text
MCP client / coding agent / CLI
              |
         browser_run
              |
       Browser Agent ------- DecisionProvider
              |              | Cloudflare Clef
       BrowserDriver         | TypeSafe Jev
       CDP / agent-browser   | OpenRouter
              |              | System One HTTP / Ollama
              v
     deterministic expect verification
              |
       done / blocked / error
```

Decision requests have one internal shape: `state + typed questions -> typed answers + probabilities`. Vendor envelopes, authentication, endpoints, and errors stay inside provider adapters. `TYPE_TEXT` uses caller-provided `inputs` when a field match is unambiguous and otherwise falls back to an OpenAI-compatible text provider.

## Project origin

Browser Pilot MCP is a fork of [0x7067/jev-browse](https://github.com/0x7067/jev-browse). The original project provided the browser-agent architecture, CDP and agent-browser drivers, indexed action space, page snapshots, action execution, completion verification, traces, evals, CLI, and MCP integration.

This fork generalizes the decision layer so that the same browser agent can use Cloudflare Clef, TypeSafe Jev, local System One-compatible models, and future decision providers. The original MIT copyright notice remains in `LICENSE`.

## Installation

Node.js 22 or later is required.

```bash
npm install -g github:ellozoid/browser-pilot-mcp
```

Installed copies execute committed files in `bundled/`; Git installation has no runtime dependency-install hook.

## MCP usage

Configure a stdio server with:

```json
{
  "mcpServers": {
    "browser-pilot": {
      "command": "npx",
      "args": ["-y", "-p", "github:ellozoid/browser-pilot-mcp", "browser-pilot-mcp"]
    }
  }
}
```

The server exposes one primary tool, `browser_run`:

```json
{
  "url": "http://localhost:3000",
  "goal": "Log in and open the settings page",
  "inputs": {
    "email": "test@example.com",
    "password": "test-password"
  },
  "expect": {
    "url_match": "/settings",
    "text_match": "Settings"
  },
  "headed": true,
  "max_steps": 30,
  "stop_at_challenge": true
}
```

The default MCP response is compact: status, final URL, step/decision counts, elapsed time, blocked cause, answer, error, and normalized `error_kind`. Set `include_history: true` for the full run result and terminal evidence. Set `headed: true` to watch the browser window for one call, or set `BROWSER_PILOT_HEADED=1` on the MCP server to make visible runs the default. An explicit `headed` value overrides the environment default.

## CLI usage

```bash
browser-pilot \
  --url http://localhost:3000 \
  --goal "Log in and open settings" \
  --inputs '{"email":"test@example.com","password":"test-password"}' \
  --expect '{"url_match":"/settings","text_match":"Settings"}' \
  --max-steps 30 \
  --stop-at-challenge
```

Use `--engine cdp` by default or `--engine agent-browser`. `--headed` shows the browser, while `--headless` overrides `BROWSER_PILOT_HEADED=1` for one CLI run. `--cdp URL`, `--trace FILE`, and `--allow-file-urls` retain their existing behavior. JSON results go to stdout and step events go to stderr. Legacy `jev-browse` and `jev-browse-mcp` binary aliases remain temporarily available.

## Decision providers

Set `BROWSER_PILOT_DECISION_PROVIDER` and `BROWSER_PILOT_DECISION_MODEL` explicitly. Model names are not restricted by a Browser Pilot whitelist.

### Cloudflare Clef and Clef Flash

```env
BROWSER_PILOT_DECISION_PROVIDER=cloudflare
BROWSER_PILOT_DECISION_MODEL=@cf/cloudflare/clef-flash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

Use `@cf/cloudflare/clef` when precision matters more than latency. The adapter calls the Workers AI model endpoint and handles the Cloudflare result envelope. Any model ID can be configured; it must implement the typed System One request/response contract expected by the agent.

### TypeSafe Jev

```env
BROWSER_PILOT_DECISION_PROVIDER=typesafe
BROWSER_PILOT_DECISION_MODEL=jev-latest
TYPESAFE_API_KEY=...
```

The TypeSafe SDK is isolated inside this adapter and is not imported by the browser-agent core.

### OpenRouter

```env
BROWSER_PILOT_DECISION_PROVIDER=openrouter
BROWSER_PILOT_DECISION_MODEL=typesafe/jev-latest
OPENROUTER_API_KEY=...
```

Override `BROWSER_PILOT_DECISION_BASE_URL` if your OpenRouter-compatible gateway uses another base URL.

### Local Ollama

Ollama 0.35.1 or later provides `/v1/systemone`. Local requests do not require an API key.

```bash
ollama pull clef-flash
```

```env
BROWSER_PILOT_DECISION_PROVIDER=ollama
BROWSER_PILOT_DECISION_MODEL=clef-flash
```

The Ollama adapter defaults to `http://127.0.0.1:11434`. It is a convenience wrapper around the generic System One provider and accepts any Ollama decision-model name.

### Generic System One endpoint

```env
BROWSER_PILOT_DECISION_PROVIDER=systemone
BROWSER_PILOT_DECISION_MODEL=SuperFastDecision-3B
BROWSER_PILOT_DECISION_BASE_URL=http://localhost:9000
```

Browser Pilot posts to `BASE_URL/v1/systemone`. To use a nonstandard full URL:

```env
BROWSER_PILOT_DECISION_ENDPOINT=http://localhost:9000/custom/systemone
BROWSER_PILOT_DECISION_API_KEY=
```

The API key is optional. A future System One-compatible model needs only configuration. A wire-incompatible service needs one adapter plus registry entry, not agent-loop changes.

## Text generation and deterministic inputs

Decision models select `TYPE_TEXT` and a field but do not generate arbitrary text. Browser Pilot first tries the `inputs` object against label, name, placeholder, and field metadata. It uses only a confident, unique match. Ambiguous or missing matches fall back to the OpenAI-compatible text provider:

```env
TEXT_MODEL=deepseek-chat
TEXT_MODEL_BASE_URL=https://api.deepseek.com/v1
TEXT_MODEL_API_KEY=...
```

Other OpenAI-compatible servers work by changing the model, base URL, and key. A local decision provider does not make text generation local automatically.

## Coding-agent workflow

1. Change the application code and start the local server.
2. Call `browser_run` with the complete flow.
3. Supply `expect` patterns that prove the UI outcome.
4. On `blocked` or `error`, rerun with `include_history: true` or inspect a trace.
5. Fix the application and repeat the same deterministic check.

This is useful for login, navigation, filters, search, forms, multi-step flows, and verifying a frontend change without making the host agent micromanage each click.

## Completion verification

`expect` supports `url_match`, `text_match`, `state_match`, and `frames_match`; every supplied regular expression must match the terminal observation. A decision model's `DONE` selection is a proposal, never proof. Important workflows should always provide deterministic expectations.

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `BROWSER_PILOT_DECISION_PROVIDER` | `cloudflare`, `typesafe`, `openrouter`, `systemone`, or `ollama` |
| `BROWSER_PILOT_DECISION_MODEL` | Arbitrary provider model ID |
| `BROWSER_PILOT_DECISION_BASE_URL` | Provider base URL |
| `BROWSER_PILOT_DECISION_ENDPOINT` | Full System One endpoint override |
| `BROWSER_PILOT_DECISION_API_KEY` | Generic optional provider key |
| `CLOUDFLARE_ACCOUNT_ID` | Workers AI account |
| `CLOUDFLARE_API_TOKEN` | Workers AI bearer token |
| `TEXT_MODEL`, `TEXT_MODEL_BASE_URL`, `TEXT_MODEL_API_KEY` | Free-form text provider |
| `BROWSER_PILOT_CDP_URL` | Existing Chrome DevTools endpoint |
| `BROWSER_PILOT_HEADED=1` | Show browser windows by default; per-call `headed` overrides it |
| `BROWSER_PILOT_PROFILE` | CDP Chrome profile directory |
| `BROWSER_PILOT_AGENT_BROWSER_PROFILE` | agent-browser profile directory |
| `BROWSER_PILOT_AGENT_BROWSER_BIN` | agent-browser executable |
| `BROWSER_PILOT_CHROME_ARGS` | Additional Chrome launch arguments |
| `BROWSER_PILOT_ALLOW_FILE_URLS=1` | Permit `file://` starts explicitly |
| `BROWSER_PILOT_TRACE_FILE` | Local JSONL trace path |

New variables take precedence over legacy `JEV_PROVIDER`, `TYPESAFE_MODEL`, `TYPESAFE_BASE_URL`, `TYPESAFE_API_KEY`, and `OPENROUTER_API_KEY`. Legacy inference works only when it is unambiguous and emits a deprecation warning. If both legacy provider keys are set, choose a provider explicitly.

## Browser engines

`cdp` launches or attaches to Chrome and uses the existing CDP driver. `agent-browser` uses its CLI session backend. Both share the same snapshot, indexed actions, stale-state checks, completion verification, and decision layer. Browser providers and decision providers are independent extension points.

## Privacy

Browser Pilot sends the configured decision provider the page URL, title, visible text, structured interactive elements, and recent action history. With a remote provider, that state leaves the machine. A local Ollama/System One provider can keep decision state local. If `TEXT_MODEL_BASE_URL` is remote, field context and generated values may still leave the machine. Traces and full histories can contain page data and typed values; protect them accordingly.

## Safety

Browser Pilot controls a real browser and is not a purchase, credential, or irreversible-action sandbox. Scope goals carefully, supervise high-impact flows, and use `stop_at_challenge` for CAPTCHA or verification boundaries. Do not treat a model's completion claim as evidence; use `expect` for important outcomes. `file://` navigation is denied by default.

## Limitations

- DOM-first observation cannot fully understand canvas-only UI, closed shadow roots, or inaccessible cross-origin frame content.
- Screenshots are not sent to decision providers by default.
- Live sites and bot defenses can make evals flaky.
- Cloud credentials and local Ollama are not required in CI, so live integrations need separate smoke tests.

## Development and tests

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build:bundle
npm run check:bundle
```

`src/decision/` contains the neutral contract, validation, registry, and adapters. `src/agent.ts` and `src/agent/` contain the preserved browser loop. `node scripts/eval.mjs` runs fixture and live behavioral suites; see `evals/README.md`.

## License

MIT. See `LICENSE`. The original `jev-browse` copyright notice is preserved.
