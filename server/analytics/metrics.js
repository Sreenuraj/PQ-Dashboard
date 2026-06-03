// server/analytics/metrics.js
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the 4 heuristic metrics (TUE / RD / CE / ERR).
//
// Used by:
//   • server/routes/tasks.js    — GET /:id/evaluate (per session)
//   • server/routes/analytics.js — /api/analytics/models (per-model aggregates)
//   • server/routes/analytics.js — /api/analytics/metric-defs (UI tooltips)
//
// Definitions are kept in lockstep with metricDefs() so the UI never has to
// hard-code the wording or formula. If you change a formula, change metricDefs
// in the same commit.
//
// IMPORTANT — NULL handling differs slightly from the plan doc §6.1 to
// preserve backward compatibility with the existing /:id/evaluate endpoint:
//   • TUE: 100 when no tool events (matches existing behavior)
//   • RD:  0 when no core actions
//   • CE:  100 when no context_pct data
//   • ERR: always defined (0 or 100)
//
// Per-session metrics are also cached in the `session_metrics` table (see
// db.js) so per-model aggregations are a cheap GROUP BY, not a per-request
// recomputation.
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_ERROR_CATEGORIES = new Set(['tool_failure', 'validation_error']);

/**
 * Compute the 4 heuristic metrics for a single session.
 * @param {Object} task  - the tasks row
 * @param {Array}  events - the events rows for this task (any order)
 * @returns {{ tue:number, rd:number, ce:number, err:number }}
 */
function computeSessionMetrics(task, events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const totalErrors = task?.error_count || safeEvents.filter(e => !!e.error_category).length;

  // ── Tool Use Efficacy (TUE) ───────────────────────────────────────────
  const toolEvents = safeEvents.filter(e => e.sub_type === 'tool');
  let tue;
  if (toolEvents.length > 0) {
    const toolErrors = toolEvents.filter(e => e.error_category && TOOL_ERROR_CATEGORIES.has(e.error_category));
    const successful = toolEvents.length - toolErrors.length;
    tue = Math.round((Math.max(0, successful) / toolEvents.length) * 100);
  } else {
    tue = 100; // no tool calls = no tool failures
  }

  // ── Reasoning Density (RD) ───────────────────────────────────────────
  const reasoningEvents = safeEvents.filter(e => e.sub_type === 'reasoning');
  const apiEvents = safeEvents.filter(e => e.sub_type === 'api_req_started');
  const totalActions = reasoningEvents.length + apiEvents.length + toolEvents.length;
  const rd = totalActions > 0
    ? Math.round((reasoningEvents.length / totalActions) * 100)
    : 0;

  // ── Context Efficiency (CE) ──────────────────────────────────────────
  const ctxEvents = apiEvents.filter(e => e.context_pct != null);
  let ce;
  if (ctxEvents.length > 0) {
    const avgCtx = ctxEvents.reduce((acc, e) => acc + e.context_pct, 0) / ctxEvents.length;
    ce = Math.round(100 - avgCtx); // 100 = window never used; 0 = window full
  } else {
    ce = 100; // no telemetry = no pressure
  }

  // ── Error Recovery (ERR) ─────────────────────────────────────────────
  let err;
  if (totalErrors === 0)        err = 100;
  else if (task?.status === 'completed') err = 100; // recovered despite errors
  else                          err = 0;   // failed/interrupted after errors

  return { tue, rd, ce, err };
}

/**
 * Aggregate per-session metric scores into per-model rollups.
 * Inputs may contain null/0 values; averages are NULL-safe.
 * @param {Array<{tue:number, rd:number, ce:number, err:number}>} perSessionMetrics
 * @returns {{ avg_tue:number|null, avg_rd:number|null, avg_ce:number|null, avg_err:number|null, scored_sessions:number }}
 */
function aggregateModelMetrics(perSessionMetrics) {
  const rows = (perSessionMetrics || []).filter(Boolean);
  if (rows.length === 0) {
    return { avg_tue: null, avg_rd: null, avg_ce: null, avg_err: null, scored_sessions: 0 };
  }
  const avg = (key) => {
    const vals = rows.map(r => r[key]).filter(v => typeof v === 'number' && !isNaN(v));
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  return {
    avg_tue: avg('tue'),
    avg_rd:  avg('rd'),
    avg_ce:  avg('ce'),
    avg_err: avg('err'),
    scored_sessions: rows.length,
  };
}

/**
 * Public definitions for UI tooltips. Served via /api/analytics/metric-defs
 * so the UI never hard-codes the wording.
 */
function metricDefs() {
  return {
    tue: {
      label: 'Tool Use Efficacy',
      short: 'TUE',
      unit: '%',
      better: 'higher',
      formula: '100 × (tool calls − tool failures) ÷ tool calls',
      details: 'Counts only tool events. A session with no tool calls scores 100 (no failures possible).',
    },
    rd: {
      label: 'Reasoning Density',
      short: 'RD',
      unit: '%',
      better: 'higher',
      formula: '100 × reasoning events ÷ (reasoning + API + tool events)',
      details: 'Reflects how often the agent paused to think before acting. 0 when no core actions were recorded.',
    },
    ce: {
      label: 'Context Efficiency',
      short: 'CE',
      unit: '%',
      better: 'higher',
      formula: '100 − average context_pct across API requests',
      details: '100 = context window was never used. 0 = context was full on average. 100 when no context telemetry was captured.',
    },
    err: {
      label: 'Error Recovery',
      short: 'ERR',
      unit: '%',
      better: 'higher',
      formula: '100 if no errors, else 100 if completed, else 0',
      details: 'A session that completes despite many errors still scores 100.',
    },
  };
}

module.exports = { computeSessionMetrics, aggregateModelMetrics, metricDefs };
