# Phase 2 — Session Behavioral Testing Implementation Tracker

## Standalone Editable Baselines
- [x] Schema migration: add `description`, `updated_at`, `contributing_sessions_json`, `excluded_tools_json`, `failed_tools_json`, `completion_message` to baselines table.
- [x] Schema migration: add `user_rating`, `completion_message` to test_results table.
- [x] Update baseline creation flow: generate UUID-based IDs, accept `description`, support any session status (not just completed).
- [x] Build Baseline Editor view (`src/js/views/baseline-editor.js`) with dual-list tool/keyword management.
- [x] Implement `PUT /api/baselines/:id` for editing expected_tools, excluded_tools, keywords, excluded keywords, descriptions, tags.
- [x] Build Enrich from Session flow (`src/js/views/baseline-enrich.js`) with diff/merge UI.
- [x] Implement `POST /api/baselines/:id/enrich` and `PUT /api/baselines/:id/merge` endpoints.
- [x] Add `contributing_sessions` tracking to baselines.

## Contextual Tool Sequences
- [x] Build auto-description engine (`server/baselines/tool-descriptions.js`) — derive labels from tool name + file path context.
- [x] Add `description` and `is_essential` fields to tool_sequence items in extraction.
- [x] Expose tool descriptions in Baseline Editor for user editing.
- [x] Rewrite MTV pattern to use essential-steps mode instead of strict ordering.

## Failed Tool Detection
- [x] Build failed tool extractor (`server/baselines/failed-tools.js`) — parse error messages for MCP, missing params, execution errors.
- [x] Integrate failed tools into baseline extraction pipeline.
- [x] Show failed tools in Session Test view.
- [x] Show failed tools in enrichment diff view.
- [x] Include failed tool data in BSE pattern scoring.

## Baselines Page Fixes
- [x] Fix Compare Models button navigation.
- [x] Replace "View Timeline" button with "Edit Baseline" (links to editor).
- [x] Update baseline card heading: add date + model badge.
- [x] Add inline tag management on baseline cards.
- [x] Remove "All Time" date filter dropdown.
- [x] Replace "Re-extract" with "Enrich from Session" button.

## Session Test Improvements
- [x] Add user interruption counting (resume_task, context resets).
- [x] Display interruption count in Session Health section.
- [x] Implement interruption penalty on overall behavioral score.
- [x] Update TIA pattern to check excluded tools from baseline.
- [x] Update BCV pattern to check excluded keywords from baseline.
- [x] Add Tool Failures section to test result display.

## Task Completion & Rating
- [x] Capture `completion_result` text in parser (`ui-messages.js`) — store as content_preview.
- [x] Extract and store completion message in baselines.
- [x] Show completion message in Session Test view.
- [x] Add completion message row to Deep Compare table.
- [x] Build star rating UI (1–5) in Session Test view.
- [x] Implement `PUT /api/test-results/:id/rate` endpoint.
- [x] Show rating in Deep Compare and Benchmarks views.

## Frontend Updates
- [x] Add API client methods: `updateBaseline`, `enrichBaseline`, `mergeEnrichment`, `rateTestResult`.
- [x] Register new routes: baseline editor, enrich view.
- [x] Update CSS: dual-list editor, diff view, star rating, health indicators.

## Updated Test Rules
- [x] Update `test-rules.yaml` with Phase 2 sections.
- [x] Update `server/testing/rules.js` to load new config sections.

## Verification
- [x] Run production build successfully.
- [x] Smoke test all new API endpoints.
- [x] Verify baseline creation → editing → enrichment flow end-to-end.
- [x] Verify session test with edited baseline (excluded tools/keywords cause failures).
- [x] Verify Compare Models works from Baselines page.
- [x] Verify interruption count and penalty display.
- [x] Verify completion message and rating in test + compare views.
