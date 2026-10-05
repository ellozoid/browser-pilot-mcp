---
name: browser-pilot
description: Run a complete bounded browser task through browser_run and verify its observable outcome. Use for local frontend checks, multi-step navigation, filters, search, forms, and other flows with a clear done condition.
---

# Browser Pilot MCP

Use `browser_run` when the whole task can be delegated to an autonomous browser loop. Give it the target site's starting URL, one complete goal, known field `inputs`, and deterministic `expect` evidence whenever possible.

Prefer this over controlling each click from the host model. Use step-by-step browser tools only for genuinely exploratory or interactive work where the next goal cannot be stated in advance.

## Coding workflow

1. Change the application code.
2. Start the application.
3. Call `browser_run` with the complete flow.
4. Add `expect.url_match`, `expect.text_match`, `expect.state_match`, or `expect.frames_match` to prove the result.
5. If the result is `blocked` or `error`, request `include_history` or inspect the trace.
6. Fix the code and repeat the same run.

## Inputs

- `url`: starting HTTP(S) URL.
- `goal`: bounded natural-language task and stopping point.
- `inputs`: known field values keyed by labels or names; unique matches bypass text generation.
- `expect`: deterministic terminal evidence. Every supplied pattern must match.
- `engine`: `cdp` or `agent-browser`.
- `headed`: show the browser window while the task runs.
- `max_steps`: action budget.
- `stop_at_challenge`: stop before interacting with visible verification.
- `include_history`: opt into the full result for debugging.

`done` is not proof by itself. For important UI verification, require `expect` evidence. Browser Pilot controls a real browser and has no built-in purchase or credential sandbox.

See [README.md](../../README.md) for provider setup, privacy, engines, and CLI usage.
