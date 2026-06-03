# Phase 4 — Implementation Progress

> **Branch:** `phase-4-agent-context`
> **Started:** 2026-06-03
> **Plan:** [`phase-4-agent-context.md`](./phase-4-agent-context.md)
> **Estimated total:** ~960 LOC

This is the live progress tracker. Updated as steps complete.

---

## 1. Server Foundation

- [ ] **1a.** Create `server/analytics/metrics.js` — TUE/RD/CE/ERR + helpers + metric defs
- [ ] **1b.** Add 4 `tasks` columns (`primary_agent`, `agent_count`, `is_multi_agent`, `agent_sequence_json`) + `session_metrics` table + 5 indexes
- [ ] **1c.** Parser denormalization — `buildAgentMeta` in `server/parser/index.js` + insert `session_metrics`
- [ ] **1d.** Add `/api/analytics/agents` + `/api/analytics/agent-matrix` + `/api/analytics/metric-defs`
- [ ] **1e.** Extend `/api/analytics/models` with `avg_tue`, `avg_rd`, `avg_ce`, `avg_err`
- [ ] **1f.** Refactor `routes/tasks.js evaluate` to use `metrics.js`
- [ ] **1g.** Add `?agent=` and `?multi_agent=` filters to `GET /api/tasks` + extend payload

## 2. Client Foundation

- [ ] **2a.** `AGENT_COLORS`, `fmtAgentChain`, `agentChip` in `src/js/utils.js`
- [ ] **2b.** New API methods in `src/js/api.js`: `agents`, `agentMatrix`, `metricDefs`
- [ ] **2c.** `MetricTooltip` helper component (loads from `/api/analytics/metric-defs`)

## 3. Overview Page

- [ ] **3a.** Master filter (agent chip row in top bar, default "All")
- [ ] **3b.** Top Models sortable by TUE/RD/CE/ERR with tooltips
- [ ] **3c.** Top Agents card (click → Sessions)

## 4. Sessions Page

- [ ] **4a.** Agent(s) column with chips + click-to-filter
- [ ] **4b.** `f-agent` filter dropdown + multi-agent toggle
- [ ] **4c.** Set-as-Baseline modal shows agent chain

## 5. Compare + Deep-Compare

- [ ] **5a.** Agent row in `compare.js` table
- [ ] **5b.** Agent chain chips in `deep-compare.js` column header

## 6. Investigate + Timeline

- [ ] **6a.** Investigate: Agents panel
- [ ] **6b.** Investigate: color-coded list borders by event mode
- [ ] **6c.** Timeline: 6px agent band above the track

## 7. Models Page

- [ ] **7a.** "Mode" → "Agent" label
- [ ] **7b.** Model × Agent heatmap matrix
- [ ] **7c.** Sortable metric columns on Model Performance Table

## 8. Activity

- [ ] **8a.** Activity × Agent matrix

## 9. Errors

- [ ] **9a.** "By Agent" tab

## 10. Baselines

- [ ] **10a.** Source agent chip on baseline cards
- [ ] **10b.** Source agent field in baseline editor

## 11. Test + Eval

- [ ] **11a.** Test evidence names the active agent at failure
- [ ] **11b.** Eval page shows the agent chain

## 12. Verification

- [ ] **12a.** Schema, data, API, UI smoke (per `phase-4-agent-context.md` §11)
- [ ] **12b.** Question-driven SQL regression checks (§11.5)
- [ ] **12c.** End-to-end: wipe DB → reparse → all pages render with agent data

---

## Notes

- **Single source of truth for metrics:** `server/analytics/metrics.js` — both the evaluate endpoint and the analytics endpoints import from it.
- **No data migration** — user will wipe `data/dashboard.db` after code lands.
- **Build order rationale:** steps 1-2 are pure infrastructure; once green, the UI steps (3-11) can be done in any order; verification (12) is last.
