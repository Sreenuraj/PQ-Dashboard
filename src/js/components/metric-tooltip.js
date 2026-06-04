// src/js/components/metric-tooltip.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: a tiny "?" icon that, on hover, shows the formula + details for one
// of the 4 heuristic metrics (TUE / RD / CE / ERR). The wording is fetched
// once from /api/analytics/metric-defs and cached for the rest of the session
// (see api.js → getMetricDefs). The UI never hard-codes the formula text.
//
// Usage:
//   import { metricTooltip } from '../components/metric-tooltip.js';
//   // In a sortable header:
//   <th>${metricTooltip('ce')} Context Efficiency ⇅</th>
//
// The tooltip is a CSS-only hover popover (no JS click handlers needed), so
// it works in any view without extra wiring.
// ─────────────────────────────────────────────────────────────────────────────

import { getMetricDefs } from '../api.js';

const STYLE_ID = 'pq-metric-tooltip-style';
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .pq-metric-tip { position: relative; display: inline-block; cursor: help; }
    .pq-metric-tip .pq-metric-tip-icon {
      display: inline-block; width: 13px; height: 13px; line-height: 13px;
      text-align: center; font-size: 9px; font-weight: 700;
      color: var(--text-3); border: 1px solid var(--border); border-radius: 50%;
      margin-left: 4px; vertical-align: middle;
      background: var(--bg-2);
    }
    .pq-metric-tip:hover .pq-metric-tip-icon { color: var(--accent); border-color: var(--accent); }
    .pq-metric-tip .pq-metric-tip-body {
      position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
      width: 280px; padding: 10px 12px; border-radius: 6px;
      background: var(--bg-2); border: 1px solid var(--border);
      box-shadow: 0 6px 18px rgba(0,0,0,0.3);
      font-size: 11px; line-height: 1.45; color: var(--text-2);
      z-index: 1000; opacity: 0; pointer-events: none;
      transition: opacity 120ms ease 50ms;
      text-align: left;
    }
    .pq-metric-tip:hover .pq-metric-tip-body,
    .pq-metric-tip.pq-metric-tip-visible .pq-metric-tip-body { opacity: 1; pointer-events: auto; }
    .pq-metric-tip .pq-metric-tip-body strong { color: var(--text); display: block; margin-bottom: 4px; }
    .pq-metric-tip .pq-metric-tip-formula {
      font-family: var(--font-mono); font-size: 10px;
      color: var(--text-3); background: var(--bg-3);
      padding: 4px 6px; border-radius: 3px; margin: 6px 0;
      white-space: pre-wrap; word-break: break-word;
    }
    .pq-metric-tip .pq-metric-tip-details { color: var(--text-3); }
  `;
  document.head.appendChild(style);
}

/**
 * Render a `?` icon with hover tooltip for the given metric.
 * @param {'tue'|'rd'|'ce'|'err'} key
 * @returns {string} HTML
 */
export function metricTooltip(key) {
  ensureStyles();
  // Synchronous render — placeholder body; we'll fill it in once metric defs load.
  // To avoid a flash, we pre-render a generic body that gets replaced.
  // (Re-render is cheap because the page is small.)
  return `
    <span class="pq-metric-tip" data-metric-key="${key}" onclick="event.stopPropagation();this.classList.toggle('pq-metric-tip-visible')">
      <span class="pq-metric-tip-icon">?</span>
      <span class="pq-metric-tip-body">
        <strong data-metric-label>…</strong>
        <div class="pq-metric-tip-formula" data-metric-formula>…</div>
        <div class="pq-metric-tip-details" data-metric-details>…</div>
      </span>
    </span>
  `;
}

/**
 * Hydrate every .pq-metric-tip in the document with the actual metric defs.
 * Call this AFTER the view has been rendered. Safe to call multiple times.
 */
export async function hydrateMetricTooltips() {
  let defs;
  try { defs = await getMetricDefs(); } catch { return; }
  for (const el of document.querySelectorAll('.pq-metric-tip[data-metric-key]')) {
    const key = el.dataset.metricKey;
    const def = defs?.[key];
    if (!def) continue;
    el.querySelector('[data-metric-label]').textContent =
      `${def.label} (${def.short}) — ${def.better} is better`;
    el.querySelector('[data-metric-formula]').textContent = def.formula;
    el.querySelector('[data-metric-details]').textContent = def.details;
  }
}
