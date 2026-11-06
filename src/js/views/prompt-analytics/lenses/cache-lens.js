import { escHtml, fmtBytes, fmtTokens, fmtCost, fmtRate } from '../helpers.js';

const CAUSE_LABELS = {
  tools_changed: 'Tools changed (proxy fingerprint)',
  provider_fallback: 'Provider fallback / routing switch',
  model_switch: 'Model switched mid-task',
  gap_exceeded_ttl: 'Idle gap exceeded cache TTL',
  context_trimmed: 'Context window auto-trimmed',
  duplicate_request: 'Duplicate request / double-send',
  system_prompt_changed: 'System prompt changed',
  provider_eviction: 'Provider-side eviction (unprovoked)',
  cause_not_recorded: 'Evicted (cause not captured)',
};

const LEVEL_STYLE = {
  confirmed: { t: 'Confirmed', c: 'var(--green)', tip: 'Backed by proxy traffic captures or extension logs' },
  strong:    { t: 'Strong',    c: '#38bdf8',      tip: 'Deterministic timing or prefix evidence' },
  inferred:  { t: 'Inferred',  c: 'var(--text-3)', tip: 'Standard industry inference' },
};

/**
 * Renders the Cache & Cost Diagnostics Analytical Lens
 * Applying taste-skill anti-slop rules:
 * - Two levels, never three (no nested outer cards)
 * - Tabular numbers with clear currency and token units
 * - Root-cause breakdown with instant turn-jump targets
 */
export function renderCacheLens(data) {
  const calls = data.apiCalls || [];
  const ca = data.cacheAnalysis || {};
  const summary = ca.summary || null;
  const evidence = ca.evidence || {};
  const fb = data.financialBreakdown || {
    modelId: data.task?.model || 'unknown',
    totalCost: data.task?.totalCost || 0,
    input: { tokens: calls.reduce((s, c) => s + (c.tokensIn || 0), 0), cost: 0, pricePerM: null },
    output: { tokens: calls.reduce((s, c) => s + (c.tokensOut || 0), 0), cost: 0, pricePerM: null },
    cacheRead: { tokens: calls.reduce((s, c) => s + (c.cacheReads || 0), 0), cost: 0, pricePerM: null },
    cacheWrite: { tokens: calls.reduce((s, c) => s + (c.cacheWrites || 0), 0), cost: 0, pricePerM: null },
  };

  const w1h = fb.cacheWrite1h || { tokens: 0, cost: 0, pricePerM: null };
  const w5m = fb.cacheWrite5m || { tokens: fb.cacheWrite?.tokens || 0, cost: fb.cacheWrite?.cost || 0, pricePerM: fb.cacheWrite?.pricePerM };
  const ttlSplit = w1h.tokens > 0
    ? `<span title="1-hour TTL writes cost more per token than 5-minute writes but survive idle gaps up to an hour">⏱ 1h ${fmtTokens(w1h.tokens)} @ ${fmtRate(w1h.pricePerM)}${w5m.tokens > 0 ? ` · 5m ${fmtTokens(w5m.tokens)} @ ${fmtRate(w5m.pricePerM)}` : ''}</span>`
    : (w5m.tokens > 0 ? `<span title="5-minute TTL writes">⏱ 5m @ ${fmtRate(w5m.pricePerM)}</span>` : '');

  // Waste by cause
  const byCause = summary?.byCause || {};
  const causeRows = Object.entries(byCause).sort((a, b) => b[1].excessCost - a[1].excessCost).map(([cause, v]) => {
    const lv = Object.keys(v.evidence || {}).sort((x, y) => ['confirmed', 'strong', 'inferred'].indexOf(x) - ['confirmed', 'strong', 'inferred'].indexOf(y))[0];
    const st = LEVEL_STYLE[lv] || LEVEL_STYLE.inferred;
    return `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 10px;font-weight:500;color:var(--text)">${escHtml(CAUSE_LABELS[cause] || cause)}</td>
        <td class="mono" style="padding:6px 10px">${v.calls}</td>
        <td class="mono" style="padding:6px 10px">${fmtTokens(v.tokensRewritten)}</td>
        <td class="mono" style="padding:6px 10px;color:#f87171;font-weight:bold">${fmtCost(v.excessCost)}</td>
        <td style="padding:6px 10px"><span title="${escHtml(st.tip)}" style="color:${st.c};font-weight:600;font-size:10px">● ${st.t}</span></td>
      </tr>
    `;
  }).join('');

  const perCall = (c) => c.cache || null;
  const spikes = calls.filter((c) => perCall(c)?.isSpike);
  const wi = summary?.ttlWhatIf;
  const w1hTokens = summary ? summary.write1hTokens : 0;
  const w5mTokens = summary ? summary.write5mTokens : (fb.cacheWrite?.tokens || 0);

  return `
    <div class="pa-cache-container">
      <!-- Header -->
      <div class="pa-lens-header">
        <div>
          <div class="pa-lens-heading">Financial Cost & Prompt Cache Diagnostics</div>
          <div class="pa-lens-subheading">
            <span>Model: <strong>${escHtml(fb.modelId || 'Model')}</strong></span>
            <span class="pa-sep">·</span>
            <span>Priced dynamically from model rate catalog${fb.unpriced?.calls ? ` · ${fb.unpriced.calls} call(s) without known price use logged cost` : ''}</span>
          </div>
        </div>
      </div>

      <!-- 5-Metric Financial Cards Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(170px, 1fr));gap:10px;margin-bottom:14px">
        <!-- 1. Input Tokens -->
        <div style="background:var(--surface-sub);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:3px;font-weight:500;text-transform:uppercase;letter-spacing:0.04em">Uncached Input</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px">${fmtTokens(fb.input?.tokens || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px">
            <span style="color:#38bdf8;font-weight:600">${fmtCost(fb.input?.cost || 0)}</span>
            <span style="color:var(--text-3)" class="mono">${fmtRate(fb.input?.pricePerM)}</span>
          </div>
        </div>

        <!-- 2. Output Tokens -->
        <div style="background:var(--surface-sub);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:3px;font-weight:500;text-transform:uppercase;letter-spacing:0.04em">Output Generation</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px">${fmtTokens(fb.output?.tokens || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px">
            <span style="color:#e879f9;font-weight:600">${fmtCost(fb.output?.cost || 0)}</span>
            <span style="color:var(--text-3)" class="mono">${fmtRate(fb.output?.pricePerM)}</span>
          </div>
        </div>

        <!-- 3. Cache Read Tokens -->
        <div style="background:var(--surface-sub);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:3px;font-weight:500;display:flex;justify-content:space-between;text-transform:uppercase;letter-spacing:0.04em">
            <span>Cache Reads</span>
            ${(() => { const i = fb.input?.pricePerM, r = fb.cacheRead?.pricePerM; return i > 0 && r != null ? `<span style="color:var(--green);font-size:9.5px;font-weight:bold;text-transform:none">⚡ ${Math.round((1 - r / i) * 100)}% off</span>` : ''; })()}
          </div>
          <div class="mono" style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px">${fmtTokens(fb.cacheRead?.tokens || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px">
            <span style="color:var(--green);font-weight:600">${fmtCost(fb.cacheRead?.cost || 0)}</span>
            <span style="color:var(--text-3)" class="mono">${fmtRate(fb.cacheRead?.pricePerM)}</span>
          </div>
        </div>

        <!-- 4. Cache Write Tokens -->
        <div style="background:var(--surface-sub);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:3px;font-weight:500;text-transform:uppercase;letter-spacing:0.04em">Cache Writes</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px">${fmtTokens(fb.cacheWrite?.tokens || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px">
            <span style="color:#f59e0b;font-weight:600">${fmtCost(fb.cacheWrite?.cost || 0)}</span>
            <span style="color:var(--text-3)" class="mono">${fmtRate(fb.cacheWrite?.pricePerM)}</span>
          </div>
          ${ttlSplit ? `<div style="margin-top:4px;font-size:9.5px;color:var(--text-3)" class="mono">${ttlSplit}</div>` : ''}
        </div>

        <!-- 5. Total Financial Cost -->
        <div style="background:var(--surface-sub);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--green);margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em">Total Task Spend</div>
          <div class="mono" style="font-size:22px;font-weight:700;color:var(--green);margin-bottom:6px">${fmtCost(fb.totalCost || data.task?.totalCost || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:var(--text-2)">
            <span>${calls.length} API Calls</span>
            <span>${fb.isMultiModel ? (fb.modelsUsed || []).length + ' models' : '100% Billable'}</span>
          </div>
        </div>
      </div>

      <!-- 1-Hour vs 5-Minute TTL Card -->
      ${summary && w1hTokens > 0 && wi ? `
        <div style="background:var(--surface-sub);padding:12px 16px;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:14px;font-size:11.5px;color:var(--text-2);line-height:1.5">
          ⏱ <strong>1-Hour vs 5-Minute Cache TTL Efficiency:</strong> ${fmtTokens(w1hTokens)} tokens were written with 1-hour TTL${w5mTokens > 0 ? ` and ${fmtTokens(w5mTokens)} with 5-minute TTL` : ''}.
          The extended TTL cost <strong>${fmtCost(wi.premium1hPaid)}</strong> extra in write creation fees and avoided <strong>${fmtCost(wi.rewritesAvoidedBy1h)}</strong> in cache rewrites after idle pauses longer than 5 minutes
          → Net impact: <strong style="color:${wi.net >= 0 ? 'var(--green)' : '#f59e0b'}">${wi.net >= 0 ? '+' : '−'}${fmtCost(Math.abs(wi.net))}</strong>.
        </div>
      ` : ''}

      <!-- Waste & Cache Miss Diagnostic Table -->
      ${summary && summary.spikes > 0 ? `
        <div style="background:var(--surface-sub);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <div style="font-weight:600;font-size:12px;color:#f87171">
              ⚠️ ${summary.spikes} Cache Miss Spike${summary.spikes > 1 ? 's' : ''} Rewrote Context — ${fmtCost(summary.totalExcessCost)} Extra (${summary.excessPct.toFixed(1)}% of Task Spend)
            </div>
            <div style="font-size:10.5px;color:var(--text-3)">Extra = cost above a clean cache hit for the identical prompt prefix</div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left">
            <thead style="color:var(--text-3);border-bottom:1px solid var(--border)">
              <tr>
                <th style="padding:6px 10px">Identified Cause</th>
                <th style="padding:6px 10px">Calls</th>
                <th style="padding:6px 10px">Tokens Rewritten</th>
                <th style="padding:6px 10px">Excess Cost</th>
                <th style="padding:6px 10px">Evidence Confidence</th>
              </tr>
            </thead>
            <tbody>${causeRows}</tbody>
          </table>
          <div style="margin-top:10px;font-size:10.5px;color:var(--text-3);display:flex;align-items:center;gap:6px">
            <span>Quick jump to miss turns:</span>
            ${spikes.map((c) => `<a href="#" class="pa-jump-spike" data-idx="${c.index}" style="color:#f87171;font-weight:bold;margin-right:4px;text-decoration:none;background:var(--surface-card);border:1px solid var(--border);padding:1px 6px;border-radius:3px">#${c.index + 1}</a>`).join('')}
          </div>
        </div>
      ` : `
        <div style="background:var(--surface-sub);padding:12px 16px;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:14px;font-size:11.5px;color:var(--green)">
          ✓ Clean Cache Prefix Stability — 0 unexpected full-prompt rewrite spikes detected during active turns.
        </div>
      `}

      <!-- Evidence Footnote -->
      ${evidence.note ? `
        <div style="font-size:11px;color:var(--text-3);background:var(--surface-sub);padding:10px 14px;border-radius:var(--radius-sm);border:1px solid var(--border)">
          🔎 <strong>Traffic Evidence:</strong> ${escHtml(evidence.note)} (${evidence.matched || 0}/${calls.length} calls correlated with proxy captures · ${evidence.extensionLogEvents || 0} extension events)
        </div>
      ` : ''}
    </div>
  `;
}
