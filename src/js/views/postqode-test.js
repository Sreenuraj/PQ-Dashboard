/**
 * PostQode Test Lab — entry point.
 *
 * This file has been refactored into a modular structure under:
 *   src/js/views/postqode-test/
 *     ├── index.js               ← orchestrator
 *     ├── template.js            ← HTML scaffold
 *     ├── checklist.js           ← accordion checklist + presets + mode switcher
 *     ├── runner.js              ← SSE stream + execution state machine
 *     ├── report.js              ← report rendering + run history
 *     └── scenarios/
 *           ├── index.js         ← barrel (combines all sheets)
 *           ├── providers-models.js
 *           ├── gui-editor.js
 *           ├── install-activation.js
 *           ├── settings-flags.js
 *           ├── mcp.js
 *           ├── history-state.js
 *           ├── chat-agent.js    ← CHAT-01 to CHAT-12 (CHAT-13 is manual-only)
 *           └── files-tools.js
 *
 * To add a new sheet: create a new file in scenarios/, export the array,
 * add it to scenarios/index.js, and add the sheet tab to template.js.
 */
export { renderPostQodeTest } from './postqode-test/index.js';
