# Session Behavioral Testing Implementation Tracker

## Backend Foundation
- [x] Add SQLite tables for baselines and persisted behavioral test results.
- [x] Add default `test-rules.yaml` configuration.
- [x] Implement baseline prompt chain and benchmark extraction.
- [x] Implement baseline CRUD API routes.
- [x] Implement deterministic behavioral test runner with all six patterns.
- [x] Implement test rules and tool registry API endpoints.
- [x] Implement deep comparison API with optional baseline reference and test results.
- [x] Register new backend routes in the Express server.

## Frontend Foundation
- [x] Add API client methods for baselines, tests, rules, registry, and deep compare.
- [x] Add routes for Baselines, Session Test, and Deep Compare views.
- [x] Add sidebar navigation for the Testing section.

## Session Workflows
- [x] Add session action buttons for Set as Baseline, Test Session, and Deep Compare.
- [x] Add baseline creation modal from selected completed sessions.
- [x] Add baseline deletion and prompt copy workflows.

## New Views
- [x] Build Baselines page with benchmark summaries and prompt chains.
- [x] Build Session Behavioral Test view with baseline selector and pattern evidence.
- [x] Build Enhanced Deep Compare view with behavioral matrix, operational metrics, and tool sequences.

## Verification
- [x] Run a production build.
- [x] Smoke test behavioral test runner against a cached completed task.
- [x] Verify baseline prompt extraction no longer treats assistant response text as a prompt.
- [x] Confirm previously started dev/API server sessions were stopped.
- [ ] Smoke test backend endpoints and UI routes in browser.

## Follow-up Fixes From Manual Testing
- [x] Add baseline-backed Deep Compare picker from the Baselines page.
- [x] Infer the baseline when a selected compare set includes an existing baseline task.
- [x] Visually highlight the baseline column in Deep Compare.
- [x] Collapse baseline cards by default so multiple baselines remain scannable.
- [x] Add Re-extract action so existing baseline benchmark data can be refreshed.
- [x] Fix prompt chain extraction to capture only the initial user prompt plus explicit user feedback.
