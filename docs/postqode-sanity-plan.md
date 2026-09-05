# PostQode Installation & Basic Sanity Plan

## Purpose

Test **PostQode** as a user would use it. PQ Dashboard selects the build, starts a test run, and displays results; it is not itself the system under test.

This applies to every supported VS Code-compatible host that the user selects. VS Code Insiders is simply the host available for current exploration, not a product limitation.

## Dashboard flow

1. Select a target IDE installation (for example VS Code, Insiders, Cursor, or Windsurf).
2. Select the PostQode build source:
   - **Already installed** — inspect and test its current version.
   - **Local build** — choose a locally built VSIX or an unpacked extension directory.
   - **Marketplace** — choose an extension version available from the marketplace.
3. Choose an installation policy:
   - **Keep current** — run against the installed version.
   - **Replace for test** — record installed version, uninstall it if present, install the selected build, verify it, then restore the prior version after the run.
4. Choose a test pack and agents. Initial choices are `All applicable`, Chat/Plan, Agent, API Agent, Web Agent, and Mobile Agent.
5. Choose response mode: **Mocked** (default), **Live provider**, or **Hybrid**. The dashboard records that choice in the report.
6. Run the pack and open a concise report with screenshots, logs, redacted request/response evidence, version/host details, and failures.

Installation changes run only in a disposable IDE profile by default. The normal user profile is never uninstalled, upgraded, signed out, or reconfigured as part of automated testing.

## Installation checks

For a selected build and host, verify:

- the selected local VSIX/directory is a valid PostQode build, or the marketplace version is resolvable;
- the previous PostQode version is detected and recorded;
- uninstall completes when **Replace for test** is selected;
- the selected version installs, activates, and exposes the PostQode activity-bar view;
- the extension starts without activation errors and can be removed/reinstalled cleanly;
- an upgrade from the prior version preserves or migrates only the expected test-profile state;
- the prior version is restored after the test when requested.

## Basic sanity pack

| Area | First assertion | Applicable agents |
|---|---|---|
| Launch and UI | PostQode opens; panel, input, agent selector, model picker, recent tasks, and top actions render without console/activation errors. | All |
| Basic chat | Submit a fixture prompt; mocked streamed response renders incrementally; stop/retry/error states remain usable. | Chat/Plan, Agent, API, Web, Mobile |
| Agent selection | Available agents can be selected; each shows the expected capabilities and does not expose unavailable tools. | All |
| Context | Add a fixture file with `@` or context control; request contains only the expected fixture context. | All applicable |
| Tools | A mocked tool sequence requests and completes read, create/edit, command, and approval flows in a disposable workspace. | Agent |
| Skills | Discover a fixture skill, enable/disable it, invoke it, and confirm the expected instruction is applied. | Agent and applicable specialist agents |
| Slash commands | `/newtask`, `/condense`, `/newrule`, `/reportbug`, and `/deep-planning` are discoverable and behave safely. | Applicable agents |
| Rules and MCP | Rules and MCP views open; enabled/disabled state persists only in the test profile. | Agent and applicable agents |
| Settings | Verify enable/disable behavior for checkpoints, MCP marketplace/display, strict Plan mode, Focus Chain, Auto Compact, multi-root workspace, memory, subagents, and YOLO safety. | Applicable agents |
| History | New task/session appears in history and can be reopened in the same test profile. | All |

Agent-specific packs come after this shared pack: API collections/test suites for API Agent, browser automation for Web Agent, device actions for Mobile Agent, and deeper file/terminal/subagent behavior for Agent.

## Mocking

Mocked is the default for repeatability and cost control. A local, per-run model endpoint must return ordered JSON or streamed SSE replies for:

- normal assistant reply;
- tool call and tool result;
- approval required / denied;
- slow stream, cancellation, malformed payload, 401, 429, and 5xx.

The test profile points only to this endpoint. No real provider keys or production task history are needed. Live mode remains optional for a small, clearly labelled smoke run; its cost, provider, and redacted evidence are shown in the report.

## Observed live rendering contract

A minimal live Agent prompt was run through the existing proxy using the configured `z-ai/glm-5.3` model. It completed for **$0.02**. The captured PostQode request was a streamed `POST` to the PostQode provider chat-completions gateway and contained 20 SSE events. The UI rendered, in order:

1. task header, running cost, and cancellation control;
2. a checkpoint card and `PostQode Request` progress state;
3. an MCP tool card (`summary-speech`) with tool name, argument JSON, description, and auto-approval state;
4. a final response card and `Task Completed` state.

The mock provider must reproduce these intermediate states, not only the final assistant text. Captured payloads become redacted fixtures; account IDs, authorization, user history, and arbitrary prompt content are never committed.

## Dashboard test controls

The PostQode Test Lab should present a selectable checklist, not a single opaque “Run tests” button.

| Control group | User controls |
|---|---|
| Target | IDE host(s), already-installed/local-build/Marketplace source, version, fresh install/upgrade/reinstall, restore policy |
| Profile | disposable workspace fixture, fresh/persisted profile, seeded skills/rules/MCP/settings, cleanup policy |
| Agents | all applicable or a named set; agent-inapplicable checks are shown as skipped rather than failed |
| Provider | mocked/live/hybrid, selected low-cost model for live checks, proxy capture on/off, request redaction |
| Scenarios | normal stream, slow stream, chunked markdown/code, tool call, multiple sequential tool calls, approval/denial, cancellation, timeout, malformed SSE/JSON, 401, 429, 5xx, disconnected network, retry/recovery |
| Assertions | UI cards/state transitions, tool arguments/results, workspace mutations, settings persistence, history, network transcript, console/activation errors |
| Evidence | screenshots, video/trace where possible, extension logs, redacted HTTP/SSE transcript, cost/duration/token summary |

The default **Sanity** checklist selects only fast, mocked, shared checks. A user can expand it, choose a particular agent, add response scenarios, or opt into the small live smoke. Presets such as `Sanity / Agent tools / Settings / Provider resilience / Release install` make the selection understandable while keeping every check individually visible.

## Provider response matrix

For each selected agent, tests must vary both content and transport shape:

- plain text, markdown, code blocks, long content, empty content, and multi-part output;
- SSE comments/progress events, token chunks, final/stop event, and JSON non-streaming response;
- valid and invalid tool-call JSON, one tool, sequential tools, parallel tools, a tool error, and a tool requiring approval;
- model/provider failures: authentication, quota/rate-limit, overloaded/5xx, timeout, connection loss, malformed/chopped stream, and cancellation;
- recovery behavior: retry, edit/re-send, cancel, new task, resume/history, and no duplicate tool/file actions.

The expected result is a stable user experience and safe state transition for every shape—not merely a successful response.

## First implementation milestone

Deliver one dashboard page/command that can inspect an installed PostQode version or accept a local VSIX, launch an isolated host profile, run four mocked checks, and show the report:

1. install/activation;
2. panel and chat UI render;
3. mocked chat response and cancellation;
4. Agent-mode read/edit workflow in a fixture workspace.

Then add the remaining shared sanity checks before any agent-specific depth. The runner must also be callable standalone from the command line; the dashboard invokes that same runner rather than duplicating test logic.
