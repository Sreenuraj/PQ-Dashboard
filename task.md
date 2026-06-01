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
- [ ] Smoke test backend endpoints and UI routes in browser.
