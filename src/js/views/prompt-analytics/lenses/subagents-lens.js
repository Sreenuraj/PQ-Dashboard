import { escHtml, fmtBytes, fmtTokens, fmtCost, fmtTime, fmtDuration, fmtRate } from '../helpers.js';

/**
 * Computes the unified subagent analysis context
 */
function getSubagentContext(data) {
  const s = data.subagentSummary;
  const hasSub = !!(s && s.hasSubagents && s.roiAnalysis);
  if (!hasSub) return null;

  const roi = s.roiAnalysis;
  const actualCost = roi.actualCost || s.totalCost || 0;
  const grounded = roi.groundedSingleAgent || roi.realisticFocused || { cost: actualCost, turns: s.totalTurns || 1, outputTokens: s.totalOutputTokens || 0, explorationPremium: 0, explorationPremiumPct: 0 };
  const modes = roi.modes || {};
  const wall = roi.wallClock || { actualSec: 0, sequentialSec: 0, savedSec: 0, speedupFactor: 1 };
  const friction = roi.scratchFriction || { redundantCost: roi.redundantWorkCost || 0, redundantTurns: 0, scratchBytes: 0 };
  const scope = roi.scopeAnalysis || { runs: [], summary: {} };

  const mainModelShort = (modes.arbitrage?.mainModel || roi.modelArbitrage?.mainModel || 'opus').split('/').pop().replace('claude-', '').replace('latest', '');
  const subModelShort = (modes.arbitrage?.subagentModel || roi.modelArbitrage?.subagentModel || 'sonnet').split('/').pop().replace('claude-', '').replace('latest', '');
  const isArbitrage = modes.arbitrage?.isActive !== false;
  const isBackground = modes.concurrency?.isBackground || false;
  const isFork = modes.context?.isFork || false;
  const totalShieldedTokens = roi.contextTokensPrevented || (s.totalTokensIn + s.totalTokensOut) || 0;

  const costDiff = actualCost - grounded.cost;
  const isCostPremium = costDiff > 0.05;
  const isCostSavings = costDiff < -0.05;
  const speedupSec = wall.savedSec || 0;
  const hasSpeedup = speedupSec >= 60;
  const speedupMin = (speedupSec / 60).toFixed(1);
  const costDelta = Math.abs(costDiff);
  const costDeltaPct = grounded.cost > 0 ? Math.round((costDelta / grounded.cost) * 100) : 0;

  let verdictType = 'tradeoff';
  let verdictTitle = '';
  let verdictSummary = '';

  if (isCostSavings && hasSpeedup) {
    verdictType = 'win';
    verdictTitle = '🏆 High Subagent ROI (Faster & Cheaper)';
    verdictSummary = `Subagents completed <strong>${(wall.speedupFactor || 1).toFixed(2)}x faster (-${speedupMin} min)</strong> and saved <strong>${fmtCost(costDelta)} (${costDeltaPct}% off)</strong> via model arbitrage, while shielding <strong>~${fmtTokens(totalShieldedTokens)}</strong> tokens from context bloat.`;
  } else if (hasSpeedup && isCostPremium) {
    verdictType = 'tradeoff';
    verdictTitle = '⚡ Concurrency & Context Win (Speed Trade-Off)';
    verdictSummary = `Subagents completed <strong>${(wall.speedupFactor || 1).toFixed(2)}x faster (-${speedupMin} min)</strong> and shielded <strong>~${fmtTokens(totalShieldedTokens)}</strong> tokens from memory, paying a <strong>+${fmtCost(costDelta)} (+${costDeltaPct}%) API cost premium</strong> across ${s.totalWorkers} parallel workers.`;
  } else if (isCostSavings) {
    verdictType = 'win';
    verdictTitle = '💰 Cost Saver (Model Arbitrage)';
    verdictSummary = `Subagents saved <strong>${fmtCost(costDelta)} (${costDeltaPct}% off)</strong> using lighter worker models with synchronous execution.`;
  } else {
    verdictType = 'neutral';
    verdictTitle = '⏱️ Parallel Execution';
    verdictSummary = `Subagents ran across ${s.totalWorkers} workers with ${s.totalTurns} turns and ~${fmtTokens(totalShieldedTokens)} tokens shielded.`;
  }

  return {
    s, roi, actualCost, grounded, modes, wall, friction, scope,
    mainModelShort, subModelShort, isArbitrage, isBackground, isFork, totalShieldedTokens,
    costDiff, isCostPremium, isCostSavings, speedupSec, hasSpeedup, speedupMin,
    costDelta, costDeltaPct, verdictType, verdictTitle, verdictSummary,
  };
}

/**
 * 1. Observability Verdict Banner
 */
export function renderSubagentsVerdictBanner(data) {
  const ctx = getSubagentContext(data);
  if (!ctx) return '';
  const { verdictType, verdictTitle, verdictSummary, hasSpeedup, wall, speedupMin, isCostPremium, costDelta } = ctx;

  return `
    <div class="pa-verdict-banner ${verdictType}">
      <div class="pa-verdict-header">
        <span class="pa-verdict-title">${verdictTitle}</span>
        <span class="pa-verdict-pill ${verdictType}">
          ${hasSpeedup ? `⚡ ${(wall.speedupFactor || 1).toFixed(2)}x Faster (-${speedupMin}m)` : ''}
          ${hasSpeedup && isCostPremium ? ' · ' : ''}
          ${isCostPremium ? `+${fmtCost(costDelta)} Cost Premium` : `-${fmtCost(costDelta)} Saved`}
        </span>
      </div>
      <div class="pa-verdict-desc">
        ${verdictSummary}
      </div>
    </div>
  `;
}

/**
 * 2. 4-KPI Grid (Prominent Numbers, At-A-Glance Verdict Badges)
 */
export function renderSubagentsKpiSection(data) {
  const ctx = getSubagentContext(data);
  if (!ctx) return '';
  const { s, roi, actualCost, grounded, wall, friction, costDelta, costDeltaPct, isCostPremium } = ctx;

  return `
    <div class="pa-kpi-grid-4">
      <!-- KPI 1: Actual Spend -->
      <div class="pa-kpi-card cyan">
        <div class="pa-kpi-top">
          <span class="pa-kpi-label">Actual Subagent Spend</span>
          <span class="pa-kpi-chip primary">⚡ ${(wall.speedupFactor || 1).toFixed(2)}x FASTER</span>
        </div>
        <div class="pa-kpi-value cyan mono">${fmtCost(actualCost)}</div>
        <div class="pa-kpi-footer">
          <span>${s.totalTurns} turns · ${fmtTokens(roi.totalOutputTokens || s.totalOutputTokens)} out</span>
          <strong class="mono">${(s.cacheHitPct || 0).toFixed(1)}% cache hit</strong>
        </div>
      </div>

      <!-- KPI 2: Single-Agent Baseline -->
      <div class="pa-kpi-card neutral">
        <div class="pa-kpi-top">
          <span class="pa-kpi-label">Single Agent Baseline</span>
          <span class="pa-kpi-chip amber">🐢 ${(wall.speedupFactor || 1).toFixed(2)}x SLOWER</span>
        </div>
        <div class="pa-kpi-value mono" style="color:var(--text)">
          ${fmtCost(grounded.cost)}
          ${isCostPremium ? `<span class="pa-kpi-delta amber mono">+${fmtCost(costDelta)} (+${costDeltaPct}%)</span>` : ''}
        </div>
        <div class="pa-kpi-footer">
          <span>~${grounded.turns || 19} turns (parallel tool calls)</span>
          <strong class="mono">${grounded.novelFilesCount != null ? grounded.novelFilesCount : 0} novel files to read</strong>
        </div>
      </div>

      <!-- KPI 3: Concurrency Speedup -->
      <div class="pa-kpi-card green">
        <div class="pa-kpi-top">
          <span class="pa-kpi-label">Concurrency Speedup</span>
          <span class="pa-kpi-chip green">${(wall.speedupFactor || 1).toFixed(2)}x FASTER</span>
        </div>
        <div class="pa-kpi-value green mono">-${(wall.savedSec / 60).toFixed(1)} min</div>
        <div class="pa-kpi-footer">
          <span>${(wall.actualSec / 60).toFixed(1)}m actual vs ${(wall.sequentialSec / 60).toFixed(1)}m seq</span>
          <strong class="mono green">${(wall.speedupFactor || 1).toFixed(2)}x parallel speedup</strong>
        </div>
      </div>

      <!-- KPI 4: Scratch Friction & Retries -->
      <div class="pa-kpi-card amber">
        <div class="pa-kpi-top">
          <span class="pa-kpi-label">Scratch Friction & Retries</span>
          <span class="pa-kpi-chip ${friction.redundantCost > 0 ? 'amber' : 'neutral'}">${friction.redundantTurns || 0} RETRY TURNS</span>
        </div>
        <div class="pa-kpi-value mono ${friction.redundantCost > 0 ? 'amber' : 'muted'}">
          ${friction.redundantCost > 0 ? `+${fmtCost(friction.redundantCost)}` : '$0.00'}
        </div>
        <div class="pa-kpi-footer">
          <span>${fmtBytes(friction.scratchBytes || 0)} offloaded to scratch</span>
          <strong class="mono ${friction.redundantTurns > 0 ? 'amber' : ''}">${friction.redundantTurns || 0} extra main turns</strong>
        </div>
      </div>
    </div>
  `;
}

/**
 * 3. Horizontal Performance Comparison Gauges
 */
export function renderSubagentsGaugesSection(data) {
  const ctx = getSubagentContext(data);
  if (!ctx) return '';
  const { wall, totalShieldedTokens } = ctx;

  return `
    <div class="pa-visual-comparison">
      <div class="pa-comparison-item">
        <div class="pa-comp-label">
          <span>⚡ <strong>Execution Wall-Clock:</strong> ${(wall.actualSec / 60).toFixed(1)} min concurrent vs ${(wall.sequentialSec / 60).toFixed(1)} min sequential</span>
          <span class="green mono"><strong>${(wall.speedupFactor || 1).toFixed(2)}x speedup</strong> (-${(wall.savedSec / 60).toFixed(1)} min)</span>
        </div>
        <div class="pa-progress-track">
          <div class="pa-progress-bar green" style="width: ${Math.min(100, Math.max(15, Math.round((wall.actualSec / (wall.sequentialSec || 1)) * 100)))}%"></div>
        </div>
      </div>

      <div class="pa-comparison-item">
        <div class="pa-comp-label">
          <span>🛡️ <strong>Main Thread Context Protection:</strong> Kept raw worker investigations out of main conversation memory</span>
          <span class="cyan mono"><strong>~${fmtTokens(totalShieldedTokens)}</strong> tokens shielded</span>
        </div>
        <div class="pa-progress-track">
          <div class="pa-progress-bar cyan" style="width: 85%"></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 4. Datadog Span Breakdown Table for Scope Matrix
 */
export function renderScopeMatrixContent(data) {
  const ctx = getSubagentContext(data);
  if (!ctx) return '';
  const { scope } = ctx;
  if (!scope.runs || scope.runs.length === 0) return '';

  return `
    <div class="pa-matrix-panel">
      <div class="pa-matrix-header">
        <div class="pa-matrix-title">
          <span>🎯 Task Independence & Scope Overlap Matrix</span>
        </div>
        <div class="pa-matrix-subtitle">
          Programmatic scope verification: <strong>${scope.summary.totalDistinctNovelFiles || 0} novel files</strong> unseen by main agent
        </div>
      </div>

      ${scope.runs.map(r => `
        <div class="pa-run-block">
          <div class="pa-run-bar">
            <div class="pa-run-bar-left">
              <strong>Run #${r.runIndex} (Call #${r.callIndex})</strong>
              <span class="pa-sep">·</span>
              <span class="pa-run-tag-cyan">${escHtml(r.taskType)}</span>
              <span class="pa-sep">·</span>
              <span>${r.workerCount} workers</span>
            </div>
            <div class="pa-run-bar-right mono">
              ${r.uniqueNovelFilesCount} novel files · ${r.uniquenessPct}% partition uniqueness
            </div>
          </div>

          <div class="pa-table-responsive">
            <table class="pa-worker-table">
              <thead>
                <tr>
                  <th style="width:30%">Worker / Target Scope</th>
                  <th style="width:20%">Novelty Percentage</th>
                  <th style="width:18%">Scope Partitioning</th>
                  <th style="width:16%">Prior Context Seen</th>
                  <th style="width:16%">Target Files</th>
                </tr>
              </thead>
              <tbody>
                ${r.workers.map((w, wIdx) => {
                  const noveltyClass = w.noveltyPct >= 75 ? 'green' : (w.noveltyPct >= 35 ? 'cyan' : 'amber');
                  return `
                    <tr>
                      <td class="pa-worker-name-cell">
                        <strong>Worker #${wIdx + 1}:</strong> ${escHtml(w.label.replace(/^Worker\s*#?\d*:?\s*/i, ''))}
                      </td>
                      <td>
                        <div class="pa-mini-gauge">
                          <div class="pa-mini-track">
                            <div class="pa-mini-fill ${noveltyClass}" style="width: ${w.noveltyPct}%"></div>
                          </div>
                          <strong class="mono ${noveltyClass}">${w.noveltyPct}%</strong>
                        </div>
                      </td>
                      <td class="mono" style="font-size:11.5px">
                        ${w.novelCount != null ? w.novelCount : (w.novelTargetCount || 0)} new · ${w.knownToMainCount || 0} prior
                      </td>
                      <td>
                        ${(w.knownToMainCount || 0) > 0
                          ? `<span class="pa-chip amber">${w.knownToMainCount} file${w.knownToMainCount === 1 ? '' : 's'} seen</span>`
                          : `<span class="pa-chip green">100% Brand-New</span>`
                        }
                      </td>
                      <td>
                        ${w.targetCount > 0 ? `
                          <details class="pa-worker-files-details">
                            <summary class="pa-expand-btn">Show ${w.targetCount} file${w.targetCount === 1 ? '' : 's'} ▸</summary>
                            <div class="pa-worker-files-dropdown">
                              ${w.targets.map(t => {
                                const isNovel = !w.knownFiles?.includes(t);
                                return `
                                  <div class="pa-worker-file-row" title="${escHtml(t)}">
                                    <span class="pa-file-tag ${isNovel ? 'new' : 'seen'}">${isNovel ? 'NEW' : 'SEEN'}</span>
                                    <span class="pa-file-path mono">${escHtml(t.split('/').pop())}</span>
                                  </div>
                                `;
                              }).join('')}
                            </div>
                          </details>
                        ` : `<span class="pa-worker-dynamic-hint">Dynamic directive</span>`}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * 5. Findings & Empirical Details
 */
export function renderSubagentsFindingsContent(data) {
  const ctx = getSubagentContext(data);
  if (!ctx) return '';
  const { s, actualCost, grounded, wall, friction, scope, mainModelShort, subModelShort, isArbitrage, isBackground, isFork, totalShieldedTokens } = ctx;

  return `
    <div class="pa-findings-section">
      <!-- Executive Synthesis Card -->
      <div class="pa-executive-card">
        <strong>💡 Scope-Grounded Reality:</strong>
        ${escHtml(grounded.basisExplanation || `Subagents were assigned ${scope.summary?.totalDistinctNovelFiles || 0} novel files unseen by the main agent. Reading them sequentially would require at least ${grounded.turns || 1} tool turns, costing ${fmtCost(grounded.cost)} on ${mainModelShort}.`)}
        Subagents completed in <strong class="cyan mono">${fmtCost(actualCost)}</strong> across ${s.totalWorkers} parallel worker${s.totalWorkers === 1 ? '' : 's'}, saving <strong>${(wall.savedSec / 60).toFixed(1)} minutes of wall-clock time</strong> and shielding <strong>~${fmtTokens(totalShieldedTokens)} tokens</strong> from context memory.
      </div>

      <!-- In-Depth Empirical Details Accordion -->
      <details class="pa-findings-accordion">
        <summary class="pa-findings-summary">
          <span>🔬 View In-Depth Analysis & Settings Details</span>
          <span style="font-size:11px;color:var(--text-3)">Click to expand</span>
        </summary>
        <div class="pa-findings-body">
          <div class="pa-findings-row">
            <span class="pa-findings-icon">🚀</span>
            <div>
              <strong>Concurrency Speedup:</strong> Completed in <strong>${(wall.actualSec / 60).toFixed(1)} min</strong> concurrent vs <strong>${(wall.sequentialSec / 60).toFixed(1)} min</strong> sequential (<strong>${(wall.savedSec / 60).toFixed(1)} min saved</strong>).
            </div>
          </div>

          <div class="pa-findings-row">
            <span class="pa-findings-icon">🛡️</span>
            <div>
              <strong>Context Window Protection:</strong> Kept <strong>~${fmtTokens(totalShieldedTokens)}</strong> of raw file contents and worker reasoning out of the main thread.
            </div>
          </div>

          <div class="pa-findings-row">
            <span class="pa-findings-icon">🎯</span>
            <div>
              <strong>Partition Uniqueness:</strong> <strong>${scope.runs?.[0]?.uniquenessPct != null ? `${scope.runs[0].uniquenessPct}%` : '100%'}</strong> inter-worker partitioning with minimal duplicate reads across workers.
            </div>
          </div>

          <div class="pa-findings-row">
            <span class="pa-findings-icon">⚙️</span>
            <div>
              <strong>PostQode Subagent Settings in Effect:</strong>
              <span>(1) <em>Model:</em> ${isArbitrage ? `Custom ID <code>${escHtml(subModelShort)}</code> (saving vs <code>${escHtml(mainModelShort)}</code>)` : `Inherited chat model (<code>${escHtml(mainModelShort)}</code>)`}. (2) <em>Concurrency:</em> ${isBackground ? 'Background mode (async non-blocking)' : 'Foreground mode (sync blocking)'}. (3) <em>Context:</em> ${isFork ? 'Fork mode (inherited conversation history)' : 'Fresh isolated context (lean memory)'}.</span>
            </div>
          </div>

          ${friction.redundantCost > 0 ? `
            <div class="pa-findings-row">
              <span class="pa-findings-icon">⚠️</span>
              <div>
                <strong>Scratch Offload Overhead:</strong>
                <span>Offloaded ${fmtBytes(friction.scratchBytes || 0)} of worker logs into scratch disk, requiring ${friction.redundantTurns || 0} extra main agent turns (+${fmtCost(friction.redundantCost)}) to re-read and verify.</span>
              </div>
            </div>
          ` : ''}
        </div>
      </details>
    </div>
  `;
}

/**
 * 6. Main render function for standalone Subagents lens
 */
export function renderSubagentsLens(data) {
  const ctx = getSubagentContext(data);
  if (!ctx) {
    return `
      <div class="pa-lens-surface" style="padding:32px 24px;text-align:center;background:var(--surface-sub);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:24px;margin-bottom:6px">🤖</div>
        <div style="font-size:13.5px;font-weight:600;color:var(--text);margin-bottom:4px">Single-Agent Thread (No Subagents Delegated)</div>
        <div style="font-size:11.5px;color:var(--text-3);max-width:520px;margin:0 auto;line-height:1.5">
          This task ran exclusively in the primary agent thread. Subagent parallel partitioning, model arbitrage, and concurrency speedups are tracked when subagents are launched via <code>use_subagents</code>.
        </div>
      </div>
    `;
  }

  const { s, roi, mainModelShort, subModelShort, isBackground, isFork } = ctx;

  return `
    <div class="pa-subagents-container">
      <!-- 1. Header Meta Strip -->
      <div class="pa-lens-header">
        <div>
          <div class="pa-lens-heading">Subagents Economics & Empirical Scope Analysis</div>
          <div class="pa-lens-subheading">
            <span>${s.totalRuns} run${s.totalRuns === 1 ? '' : 's'}</span>
            <span>·</span>
            <span>${s.totalWorkers} parallel worker${s.totalWorkers === 1 ? '' : 's'}</span>
            <span>·</span>
            <span>${s.totalTurns} turns</span>
            <span class="pa-sep">·</span>
            <span>Arbitrage: <strong>${escHtml(subModelShort)}</strong> (workers) vs <strong>${escHtml(mainModelShort)}</strong> (main)</span>
            <span class="pa-sep">·</span>
            <span>${escHtml(roi.ttlMode || 'Prompt Cache Active')}</span>
          </div>
        </div>
        <div class="pa-mode-chips">
          <span class="pa-mode-chip">${isBackground ? 'Async Background' : 'Sync Foreground'}</span>
          <span class="pa-mode-chip">${isFork ? 'Forked Context' : 'Fresh Context'}</span>
        </div>
      </div>

      <!-- Verdict Banner -->
      ${renderSubagentsVerdictBanner(data)}

      <!-- 2. 4-KPI Grid -->
      ${renderSubagentsKpiSection(data)}

      <!-- 3. Performance Visualisation Bar -->
      ${renderSubagentsGaugesSection(data)}

      <!-- 4. Scope Matrix -->
      ${renderScopeMatrixContent(data)}

      <!-- 5. Findings & Evidence -->
      ${renderSubagentsFindingsContent(data)}
    </div>
  `;
}
